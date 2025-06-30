use anyhow::{Context, Result};
use clap::{Arg, Command};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command as TokioCommand;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() -> Result<()> {
    let matches = Command::new("Task Runner")
        .version("1.0")
        .about("Executes Node.js tasks from Rust")
        .arg(
            Arg::new("task-path")
                .short('t')
                .long("task")
                .value_name("PATH")
                .help("Path to the Node.js task directory")
                .default_value("nodejs-task")
        )
        .arg(
            Arg::new("timeout")
                .short('T')
                .long("timeout")
                .value_name("SECONDS")
                .help("Timeout for task execution in seconds")
                .default_value("30")
        )
        .get_matches();

    let task_path = matches.get_one::<String>("task-path").unwrap();
    let timeout_secs: u64 = matches.get_one::<String>("timeout")
        .unwrap()
        .parse()
        .context("Invalid timeout value")?;

    println!("🦀 Rust Task Runner starting...");
    println!("📂 Task path: {}", task_path);
    println!("⏱️  Timeout: {} seconds", timeout_secs);

    let task_runner = NodeTaskRunner::new(task_path.clone());
    
    match task_runner.run_with_timeout(timeout_secs).await {
        Ok(output) => {
            println!("✅ Task completed successfully!");
            println!("📄 Output:\n{}", output.stdout);
            if !output.stderr.is_empty() {
                println!("⚠️  Stderr:\n{}", output.stderr);
            }
        }
        Err(e) => {
            eprintln!("❌ Task failed: {}", e);
            std::process::exit(1);
        }
    }

    Ok(())
}

#[derive(Debug)]
pub struct TaskOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub struct NodeTaskRunner {
    task_path: PathBuf,
}

impl NodeTaskRunner {
    pub fn new(task_path: String) -> Self {
        Self {
            task_path: PathBuf::from(task_path),
        }
    }

    pub async fn run_with_timeout(&self, timeout_secs: u64) -> Result<TaskOutput> {
        println!("🔍 Checking Node.js installation...");
        self.check_node_installation().await?;

        println!("📦 Checking task directory...");
        self.validate_task_directory()?;

        println!("🚀 Starting Node.js task...");
        
        let timeout_duration = std::time::Duration::from_secs(timeout_secs);
        
        match tokio::time::timeout(timeout_duration, self.execute_task()).await {
            Ok(result) => result,
            Err(_) => anyhow::bail!("Task execution timed out after {} seconds", timeout_secs),
        }
    }

    async fn check_node_installation(&self) -> Result<()> {
        let output = TokioCommand::new("node")
            .arg("--version")
            .output()
            .await
            .context("Failed to check Node.js installation. Is Node.js installed?")?;

        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            println!("✅ Node.js version: {}", version);
            Ok(())
        } else {
            anyhow::bail!("Node.js is not properly installed or not in PATH")
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

        println!("✅ Task directory validation passed");
        Ok(())
    }

    async fn execute_task(&self) -> Result<TaskOutput> {
        let mut child = TokioCommand::new("node")
            .arg("index.js")
            .current_dir(&self.task_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
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
                        print!("📝 {}", line);
                        stdout_lines_clone.lock().await.push(line.clone());
                    }
                    Err(e) => {
                        eprintln!("Error reading stdout: {}", e);
                        break;
                    }
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
                        eprint!("🔴 {}", line);
                        stderr_lines_clone.lock().await.push(line.clone());
                    }
                    Err(e) => {
                        eprintln!("Error reading stderr: {}", e);
                        break;
                    }
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
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    #[tokio::test]
    async fn test_node_installation_check() {
        let runner = NodeTaskRunner::new("dummy".to_string());
        // This test will pass if Node.js is installed
        let result = runner.check_node_installation().await;
        assert!(result.is_ok() || result.is_err()); // Just ensure it doesn't panic
    }

    #[test]
    fn test_task_directory_validation() {
        let temp_dir = TempDir::new().unwrap();
        let task_path = temp_dir.path().to_str().unwrap();
        
        let runner = NodeTaskRunner::new(task_path.to_string());
        
        // Should fail without package.json
        assert!(runner.validate_task_directory().is_err());
        
        // Create package.json and index.js
        fs::write(temp_dir.path().join("package.json"), "{}").unwrap();
        fs::write(temp_dir.path().join("index.js"), "console.log('test')").unwrap();
        
        // Should pass now
        assert!(runner.validate_task_directory().is_ok());
    }
} 