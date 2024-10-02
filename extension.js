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
        this.extensionUri = context.extensionUri;

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
            } else if (message.command === 'editTask') {
                this.editTask(message.index, message.description);
            } else if (message.command === 'deleteTask') {
                this.deleteTask(message.index);
            } else if (message.command === 'toggleTask') {
                this.toggleTask(message.index);
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
            vscode.commands.registerCommand('extension.editTask', (index, description) => this.editTask(index, description)),
            vscode.commands.registerCommand('extension.toggleTask', (index) => this.toggleTask(index)),
            vscode.commands.registerCommand('extension.deleteTask', (index) => this.deleteTask(index)),
        );
    }

    editTask(index, description) {
        if (index >= 0 && index < this.tasks.length) {
            this.tasks[index].description = description;
            this.updateViews();
        }
    }

    toggleTask(index) {
        if (index >= 0 && index < this.tasks.length) {
            this.tasks[index].completed = !this.tasks[index].completed;
            this.updateViews();
        }
    }

    deleteTask(index) {
        if (index >= 0 && index < this.tasks.length) {
            this.tasks.splice(index, 1);
            this.updateViews();
        }
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
        this.updateViews();
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

        const timerInterval = setInterval(() => {
            const remainingTime = endTime - Date.now();
            if (remainingTime <= 0) {
                clearInterval(timerInterval);
                notifier.notify({ title: "Time's up!", message: `${label} timer has completed.`, sound: true });
                vscode.window.showInformationMessage(`${label} timer has completed.`);
                this.timers = this.timers.filter(t => t.label !== label);
                this.updateStatusBar();
            } else {
                const minutesLeft = Math.floor(remainingTime / (60 * 1000));
                const secondsLeft = Math.floor((remainingTime % (60 * 1000)) / 1000);
                this.updateStatusBar();
            }
        }, 1000);

        this.timers.push({ label, timerInterval, endTime });
        this.updateViews();
    }

    // Function to stop a timer
    stopTimer(label) {
        const timer = this.timers.find(timer => timer.label === label);
        if (timer) {
            clearInterval(timer.timerInterval);
            vscode.window.showInformationMessage(`${label} timer stopped.`);
            this.timers = this.timers.filter(t => t.label !== label);
            this.updateViews();
        } else {
            vscode.window.showErrorMessage(`No timer found with label "${label}".`);
        }
    }

    // Function to clear all timers
    clearTimers() {
        this.timers.forEach(timer => {
            clearInterval(timer.timerInterval);
        });
        this.timers = []; // Correctly reference 'this.timers'
        this.context.globalState.update('activeTimers', []); // Also clear from global state
        vscode.window.showInformationMessage('All timers cleared.');
        this.updateViews();
    }

    // Function to restore timers (after VS Code restart)
    restoreTimers() {
        this.timers = [];
        const stored_timers = this.context.globalState.get('activeTimers') || [];
        
        stored_timers.forEach(timer => {
            const remainingTime = timer.endTime - Date.now();
            if (remainingTime <= 0) {
                vscode.window.showInformationMessage(`${timer.label} timer has completed.`);
            } else {
                const timerInterval = setInterval(() => {
                    const timeRemaining = timer.endTime - Date.now();
                    if (timeRemaining <= 0) {
                        clearInterval(timerInterval);
                    }
                }, 1000);

                this.timers.push({
                    label: timer.label,
                    endTime: timer.endTime,
                    timerInterval
                });
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
        if (this.webviewView) {
            const serializedTimers = this.timers.map(timer => ({
                label: timer.label,
                remaining: `${Math.floor((timer.endTime - Date.now()) / (60 * 1000))} min`
            }));
            this.webviewView.webview.postMessage({
                command: 'update',
                tasks: this.tasks,
                timers: serializedTimers
            });
        }
    }

    updateViews() {
        this.updateStatusBar();
        this.sendDataToWebview();

        // Store only serializable data in globalState (avoid circular structures)
        const serializedTimers = this.timers.map(timer => ({
            label: timer.label,
            endTime: timer.endTime // Only store label and endTime, not the actual interval
        }));
        this.context.globalState.update('activeTimers', serializedTimers);
        this.context.globalState.update('tasks', this.tasks);
    }

    // Function to get the webview HTML content
    getWebviewContent() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Task Manager</title>
            <link rel="stylesheet" href="${this.webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'))}">
        </head>
        <body>
            <h1>Task Manager</h1>
            <ul id="tasksList"></ul>
            <h2>Timers</h2>
            <ul id="timersList"></ul>
            
            <script>
                const vscode = acquireVsCodeApi();
    
                function renderTasks(tasks) {
                    const tasksListElement = document.getElementById('tasksList');
                    tasksListElement.innerHTML = '';
                    tasks.forEach((task, index) => {
                        const taskItem = document.createElement('li');
                        
                        const checkMark = document.createElement('span');
                        checkMark.textContent = task.completed ? '✔️' : '⬜';
                        checkMark.style.cursor = 'pointer';
                        checkMark.addEventListener('click', () => {
                            vscode.postMessage({ command: 'toggleTask', index });
                        });

                        const description = document.createElement('span');
                        description.textContent = task.description;
                        description.contentEditable = true;
                        description.addEventListener('blur', () => {
                            vscode.postMessage({ command: 'editTask', index, description: description.textContent });
                        });
                        description.addEventListener('keydown', (event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault(); // Prevent newline
                                vscode.postMessage({ command: 'editTask', index, description: description.textContent });
                                description.blur(); // Remove focus after editing
                            }
                        });

                        const deleteTask = document.createElement('a');
                        deleteTask.textContent = '❌';
                        deleteTask.style.cursor = 'pointer';
                        deleteTask.addEventListener('click', () => {
                            console.log('Delete task event handler fired');
                            vscode.postMessage({ command: 'deleteTask', index });
                        });
    
                        taskItem.appendChild(checkMark);
                        taskItem.appendChild(description);
                        taskItem.appendChild(deleteTask);
                        tasksListElement.appendChild(taskItem);
                    });
                }
    
                function renderTimers(timers) {
                    const timersListElement = document.getElementById('timersList');
                    timersListElement.innerHTML = '';
                    timers.forEach(timer => {
                        const timerItem = document.createElement('li');
    
                        const label = document.createElement('span');
                        label.textContent = timer.label;
    
                        const remainingTime = document.createElement('span');
                        remainingTime.textContent = timer.remaining;
    
                        timerItem.appendChild(label);
                        timerItem.appendChild(remainingTime);
                        timersListElement.appendChild(timerItem);
                    });
                }
    
                window.addEventListener('message', event => {
                    const data = event.data;
                    renderTasks(data.tasks);
                    renderTimers(data.timers);
                });
    
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
		});
	}
}

exports.activate = activate;
exports.deactivate = deactivate;
