use anyhow::{Context, Result};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command as TokioCommand;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskConfig {
    pub task_path: String,
    pub timeout_secs: u64,
    pub args: Vec<String>,
    pub env_vars: HashMap<String, String>,
}

impl Default for TaskConfig {
    fn default() -> Self {
        Self {
            task_path: "nodejs-task".to_string(),
            timeout_secs: 30,
            args: vec![],
            env_vars: HashMap::new(),
        }
    }
}

pub struct NodeTaskRunner {
    task_path: PathBuf,
    timeout_secs: u64,
    args: Vec<String>,
    env_vars: HashMap<String, String>,
}

impl NodeTaskRunner {
    pub fn new(config: TaskConfig) -> Self {
        Self {
            task_path: PathBuf::from(config.task_path),
            timeout_secs: config.timeout_secs,
            args: config.args,
            env_vars: config.env_vars,
        }
    }

    pub async fn run(&self) -> Result<TaskOutput> {
        let start_time = std::time::Instant::now();
        
        self.validate_task_directory()?;
        self.validate_node_installation().await?;
        
        let timeout_duration = std::time::Duration::from_secs(self.timeout_secs);
        
        match tokio::time::timeout(timeout_duration, self.execute_task()).await {
            Ok(result) => {
                match result {
                    Ok(mut task_output) => {
                        task_output.execution_time_ms = start_time.elapsed().as_millis() as u64;
                        Ok(task_output)
                    },
                    Err(e) => Err(e),
                }
            },
            Err(_) => anyhow::bail!("Task execution timed out after {} seconds", self.timeout_secs),
        }
    }

    fn validate_task_directory(&self) -> Result<()> {
        if !self.task_path.exists() {
            anyhow::bail!("Task directory does not exist: {}", self.task_path.display());
        }

        let package_json = self.task_path.join("package.json");
        if !package_json.exists() {
            anyhow::bail!("package.json not found in task directory");
        }

        let index_js = self.task_path.join("index.js");
        if !index_js.exists() {
            anyhow::bail!("index.js not found in task directory");
        }

        Ok(())
    }

    async fn validate_node_installation(&self) -> Result<()> {
        let node_path = "/nodejs/bin/node";
        
        // Check if the static Node.js binary exists
        if !std::path::Path::new(node_path).exists() {
            anyhow::bail!("Static Node.js binary not found at {}", node_path);
        }

        // Test Node.js binary by running --version
        let output = TokioCommand::new(node_path)
            .arg("--version")
            .output()
            .await
            .context("Failed to check Node.js version")?;

        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            tracing::debug!("Static Node.js version: {}", version);
            Ok(())
        } else {
            let error = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Node.js binary failed to run: {}", error)
        }
    }

    async fn execute_task(&self) -> Result<TaskOutput> {
        // Use the static Node.js binary from the new path in container
        let node_path = "/nodejs/bin/node";
        let mut cmd = TokioCommand::new(node_path);
        cmd.arg("index.js")
           .current_dir(&self.task_path)
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());

        // Add environment variables from AppState
        for (key, value) in &self.env_vars {
            cmd.env(key, value);
        }

        // Add any additional arguments
        for arg in &self.args {
            cmd.arg(arg);
        }

        let mut child = cmd.spawn()
            .context("Failed to spawn Node.js process")?;

        let stdout = child.stdout.take().context("Failed to get stdout")?;
        let stderr = child.stderr.take().context("Failed to get stderr")?;

        let stdout_reader = BufReader::new(stdout);
        let stderr_reader = BufReader::new(stderr);

        let stdout_lines = Arc::new(Mutex::new(Vec::new()));
        let stderr_lines = Arc::new(Mutex::new(Vec::new()));

        // Clone for tasks
        let stdout_lines_clone = Arc::clone(&stdout_lines);
        let stderr_lines_clone = Arc::clone(&stderr_lines);

        // Read stdout and stderr concurrently
        let stdout_task = async move {
            let mut stdout_reader = stdout_reader;
            let mut line = String::new();
            loop {
                line.clear();
                match stdout_reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        stdout_lines_clone.lock().await.push(line.clone());
                    }
                    Err(_) => break,
                }
            }
        };

        let stderr_task = async move {
            let mut stderr_reader = stderr_reader;
            let mut line = String::new();
            loop {
                line.clear();
                match stderr_reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        stderr_lines_clone.lock().await.push(line.clone());
                    }
                    Err(_) => break,
                }
            }
        };

        // Wait for both stdout/stderr reading and process completion
        tokio::try_join!(
            tokio::spawn(stdout_task),
            tokio::spawn(stderr_task)
        )?;

        let status = child.wait().await.context("Failed to wait for child process")?;
        let exit_code = status.code().unwrap_or(-1);

        let stdout_data = stdout_lines.lock().await.join("");
        let stderr_data = stderr_lines.lock().await.join("");

        Ok(TaskOutput {
            stdout: stdout_data,
            stderr: stderr_data,
            exit_code,
            execution_time_ms: 0, // Will be set by the caller
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    #[test]
    fn test_task_directory_validation() {
        let temp_dir = TempDir::new().unwrap();
        let task_path = temp_dir.path().to_str().unwrap();
        
        let config = TaskConfig {
            task_path: task_path.to_string(),
            ..Default::default()
        };
        let runner = NodeTaskRunner::new(config);
        
        // Should fail without package.json
        assert!(runner.validate_task_directory().is_err());
        
        // Create package.json and index.js
        fs::write(temp_dir.path().join("package.json"), "{}").unwrap();
        fs::write(temp_dir.path().join("index.js"), "console.log('test')").unwrap();
        
        // Should pass now
        assert!(runner.validate_task_directory().is_ok());
    }
} 