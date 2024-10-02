const vscode = require('vscode');
const notifier = require('node-notifier');

// TaskTimerProvider to handle webview for tasks and timers
class TaskTimerProvider {
    constructor(context) {
        this.context = context;
        this.webviewView = null;
        this.timerStatusBarItem = null;
		this.taskStatusBarItem = null;
		this.timers = []
		this.tasks = []

        // Initialize storage if not present
        if (!context.globalState.get('activeTimers')) {
            context.globalState.update('activeTimers', []);
        }
        if (!context.globalState.get('tasks')) {
            context.globalState.update('tasks', []);
        }

        // Restore existing timers on activation
        this.initializeStatusBar();
        this.restoreTimers();
		this.restoreTasks();
        this.registerCommands();
    }

    resolveWebviewView(webviewView) {
        this.webviewView = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getWebviewContent();

        webviewView.webview.onDidReceiveMessage((message) => {
            if (message.command === 'getData') {
                this.sendDataToWebview();
            }
        }, undefined, this.context.subscriptions);
    }

    // Function to register commands
    registerCommands() {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('extension.startTimer', () => this.startTimer()),
            vscode.commands.registerCommand('extension.stopTimer', (label) => this.stopTimer(label)),
            vscode.commands.registerCommand('extension.clearTimers', () => this.clearTimers()),
            vscode.commands.registerCommand('extension.showTaskManager', () => this.showTaskManager()),
			vscode.commands.registerCommand('extension.addTask', () => this.addTask()),
        );
    }

    // Function to initialize the status bar
    initializeStatusBar() {
        this.timerStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.timerStatusBarItem.command = 'extension.showTaskManager'; // Clicking will show task manager
        this.timerStatusBarItem.tooltip = 'Show Task Manager';
        this.timerStatusBarItem.text = 'No active timers';
        this.timerStatusBarItem.show(); // Show the status bar item
        this.context.subscriptions.push(this.timerStatusBarItem); // Subscribe to context

		this.taskStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.taskStatusBarItem.command = 'extension.showTaskManager'; // Clicking will show task manager
        this.taskStatusBarItem.tooltip = 'Show Task Manager';
        this.taskStatusBarItem.text = 'No tasks';
        this.taskStatusBarItem.show(); // Show the status bar item
        this.context.subscriptions.push(this.taskStatusBarItem); // Subscribe to context

        this.updateStatusBar();
    }

    // Function to update the status bar
    updateStatusBar() {
        const activeTimers = this.timers.length;
        if (activeTimers === 0) {
            this.timerStatusBarItem.text = 'No active timers';
        } else {
            const nextTimer = this.timers.sort((a, b) => a.endTime - b.endTime)[0];
            const remainingTime = nextTimer.endTime - Date.now();
            const minutesLeft = Math.floor(remainingTime / (60 * 1000));
            const secondsLeft = Math.floor((remainingTime % (60 * 1000)) / 1000);
            this.timerStatusBarItem.text = `${activeTimers} active timer(s) 🕒 ${nextTimer.label}: ${minutesLeft}:${secondsLeft.toString().padStart(2, '0')}`;
        }

		const totalTasks = this.tasks.length;
		if (totalTasks > 0) {
			const completedTasks = this.tasks.filter(t => t.completed).length;
			this.taskStatusBarItem.text = `${completedTasks}/${totalTasks} tasks completed`
		} else {
			this.taskStatusBarItem.text = `No tasks`
		}
    }

	async addTask() {
		let task = await vscode.window.showInputBox({ prompt: 'Enter a task (Esc to cancel)' });
        if (!task) return;
		this.tasks.push({ description: task, completed: false });
		this.updateStatusBar();
		this.sendDataToWebview();
	}

    // Function to start a new timer
    async startTimer() {
        let label = await vscode.window.showInputBox({ prompt: 'Enter a label for the timer (e.g., Build, Deployment)' });
        if (!label) return;

        const minutesStr = await vscode.window.showInputBox({
            prompt: `Enter the number of minutes for the ${label} timer`,
            validateInput: value => (isNaN(parseInt(value)) || parseInt(value) <= 0) ? 'Please enter a positive number' : null
        });
        if (!minutesStr) return;

        const minutes = parseInt(minutesStr);
        const endTime = Date.now() + minutes * 60 * 1000;

        while (this.timers.some(t => t.label === label)) {
            label += '*';
        }

        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.text = `${label}: ${minutes}:00`;
        statusBarItem.tooltip = "Click to stop";
        statusBarItem.command = {
            command: 'extension.stopTimer',
            arguments: [label]
        };
        statusBarItem.show();
        this.context.subscriptions.push(statusBarItem);

        const timerInterval = setInterval(() => {
            const remainingTime = endTime - Date.now();
            if (remainingTime <= 0) {
                clearInterval(timerInterval);
                statusBarItem.hide();
                statusBarItem.dispose();
                notifier.notify({ title: "Time's up!", message: `${label} timer has completed.`, sound: true });
                vscode.window.showInformationMessage(`${label} timer has completed.`);
                this.timers = this.timers.filter(t => t.label !== label);
                this.updateStatusBar();
            } else {
                const minutesLeft = Math.floor(remainingTime / (60 * 1000));
                const secondsLeft = Math.floor((remainingTime % (60 * 1000)) / 1000);
                statusBarItem.text = `${label}: ${minutesLeft}:${secondsLeft.toString().padStart(2, '0')}`;
				this.updateStatusBar();
            }
        }, 1000);

        this.timers.push({ label, timerInterval, statusBarItem, endTime });
        this.updateStatusBar();
		this.sendDataToWebview();
    }

    // Function to stop a timer
    stopTimer(label) {
        const timer = this.timers.find(timer => timer.label === label);
        if (timer) {
            clearInterval(timer.timerInterval);
            timer.statusBarItem.hide();
            timer.statusBarItem.dispose();
            vscode.window.showInformationMessage(`${label} timer stopped.`);
            this.timers = this.timers.filter(t => t.label !== label);
            this.updateStatusBar();
			this.sendDataToWebview();
        } else {
            vscode.window.showErrorMessage(`No timer found with label "${label}".`);
        }
    }

    // Function to clear all timers
    clearTimers() {
        this.timers.forEach(timer => {
            clearInterval(timer.timerInterval);
            timer.statusBarItem.hide();
            timer.statusBarItem.dispose();
        });
        timers = [];
        vscode.window.showInformationMessage('All timers cleared.');
        this.updateStatusBar();
		this.sendDataToWebview();
    }

    // Function to restore timers (after VS Code restart)
    restoreTimers() {
		this.timers = []
		const stored_timers = this.context.globalState.get('activeTimers');
        stored_timers.forEach(timer => {
            const remainingTime = timer.endTime - Date.now();
            if (remainingTime <= 0) {
                vscode.window.showInformationMessage(`${timer.label} timer has completed.`);
            } else {
				this.timers.push(timer)
                const timerInterval = setInterval(() => {
                    const timeRemaining = timer.endTime - Date.now();
                    // if (timeRemaining <= 0) {
                    //     clearInterval(timerInterval);
                    //     timer.statusBarItem.hide();
                    //     timer.statusBarItem.dispose();
                    //     vscode.window.showInformationMessage(`${timer.label} timer has completed.`);
                    //     timers = this.timers.filter(t => t.label !== timer.label);
                    //     this.updateStatusBar();
                    // } else {
                        const minutesLeft = Math.floor(timeRemaining / (60 * 1000));
                        const secondsLeft = Math.floor((timeRemaining % (60 * 1000)) / 1000);
                        timer.statusBarItem.text = `${timer.label}: ${minutesLeft}:${secondsLeft.toString().padStart(2, '0')}`;
                    // }
                }, 1000);
                timer.timerInterval = timerInterval;
            }
        });
        this.updateStatusBar();
    }

	restoreTasks() {
		this.tasks = this.context.globalState.get('tasks');
	}

    // Function to show the task manager (webview)
    showTaskManager() {
        if (this.webviewView) {
            this.webviewView.show();
        }
    }

    // Function to send data to the webview
    sendDataToWebview() {
        // const tasks = this.context.globalState.get('tasks') || [];
        // const remainingTimers = this.timers.map(timer => {
        //     const remainingTime = timer.endTime - Date.now();
        //     const minutesLeft = Math.floor(remainingTime / (60 * 1000));
        //     const secondsLeft = Math.floor((remainingTime % (60 * 1000)) / 1000);
        //     return { label: timer.label, remaining: `${minutesLeft}:${secondsLeft.toString().padStart(2, '0')}` };
        // });

        if (this.webviewView) {
            this.webviewView.webview.postMessage({ command: 'update', tasks: this.tasks, timers: this.timers });
        }
    }

    // Function to get the webview HTML content
    getWebviewContent() {
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Task Manager</title>
			<style>
				body {
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif;
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					margin: 0;
					padding: 16px;
				}
				h1, h2 {
					color: var(--vscode-editor-foreground);
				}
				#tasksList li, #timersList div {
					display: flex;
					align-items: center;
					padding: 8px;
					border-bottom: 1px solid var(--vscode-editorGroup-border);
				}
				#tasksList input[type="checkbox"] {
					margin-right: 10px;
				}
				#timersList div {
					justify-content: space-between;
				}
				.timer-label {
					font-weight: bold;
				}
				.timer-value {
					color: var(--vscode-editor-selectionForeground);
				}
				.refresh-icon {
					position: absolute;
					top: 10px;
					right: 16px;
					cursor: pointer;
					color: var(--vscode-editor-foreground);
					font-size: 20px;
				}
				.task-input {
					flex-grow: 1;
					padding: 8px;
					border: none;
					background-color: var(--vscode-editor-background);
					color: var(--vscode-foreground);
				}
				.task-input:focus {
					outline: none;
					border-bottom: 1px solid var(--vscode-editor-hoverHighlight);
				}
			</style>
		</head>
		<body>
			<h1>Task Manager</h1>
			<div class="refresh-icon" id="refreshBtn">&#x21bb;</div>
			<ul id="tasksList"></ul>
			<h2>Timers</h2>
			<div id="timersList"></div>
			
			<script>
				const vscode = acquireVsCodeApi();
	
				// Function to render tasks
				function renderTasks(tasks) {
					const tasksList = document.getElementById('tasksList');
					tasksList.innerHTML = '';
					tasks.forEach((task, index) => {
						const taskItem = document.createElement('li');
						
						// Create checkbox for completion
						const checkbox = document.createElement('input');
						checkbox.type = 'checkbox';
						checkbox.checked = task.completed;
						checkbox.addEventListener('change', () => {
							vscode.postMessage({ command: 'toggleTask', index: index });
						});
	
						// Create input field for editing task
						const taskInput = document.createElement('input');
						taskInput.type = 'text';
						taskInput.className = 'task-input';
						taskInput.value = task.description;
						taskInput.addEventListener('keydown', (e) => {
							if (e.key === 'Enter') {
								vscode.postMessage({ command: 'addTask', afterIndex: index });
							}
						});
						taskInput.addEventListener('blur', () => {
							vscode.postMessage({ command: 'editTask', index: index, description: taskInput.value });
						});
	
						taskItem.appendChild(checkbox);
						taskItem.appendChild(taskInput);
						tasksList.appendChild(taskItem);
					});
				}
	
				// Function to render timers
				function renderTimers(timers) {
					const timersList = document.getElementById('timersList');
					timersList.innerHTML = '';
					timers.forEach(timer => {
						const timerItem = document.createElement('div');
						const timerLabel = document.createElement('span');
						timerLabel.className = 'timer-label';
						timerLabel.textContent = timer.label;
	
						const timerValue = document.createElement('span');
						timerValue.className = 'timer-value';
						timerValue.textContent = timer.remaining;
	
						timerItem.appendChild(timerLabel);
						timerItem.appendChild(timerValue);
						timersList.appendChild(timerItem);
					});
				}
	
				// Message listener from extension
				window.addEventListener('message', event => {
					const data = event.data;
					renderTasks(data.tasks);
					renderTimers(data.timers);
				});
	
				// Refresh button event
				document.getElementById('refreshBtn').addEventListener('click', () => {
					vscode.postMessage({ command: 'getData' });
				});

				// Refresh once
				vscode.postMessage({ command: 'getData' });
			</script>
		</body>
		</html>`;
	}
	
}

// Function to activate the extension
let taskTimerProvider;
function activate(context) {
    taskTimerProvider = new TaskTimerProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('tasks', taskTimerProvider));
}

// Cleanup on deactivation
function deactivate() {
	if (taskTimerProvider && taskTimerProvider.timers) {
		taskTimerProvider.timers.forEach(timer => {
			clearInterval(timer.timerInterval);
			timer.statusBarItem.dispose();
		});
	}
}

exports.activate = activate;
exports.deactivate = deactivate;
