import * as vscode from 'vscode';
import net = require('net');
import { spawn, ChildProcess } from 'child_process';
import { dirname, resolve } from 'path';
import getPort = require('get-port');

class RKernel {
  private kernelScript: string;
  private cwd: string;
  private process: ChildProcess;
  private port: number;

  constructor(kernelScript: string, doc: vscode.NotebookDocument) {
    this.kernelScript = kernelScript;
    this.cwd = dirname(doc.uri.fsPath);
  }

  public async start() {
    if (this.process) {
      return;
    }

    const env = Object.create(process.env);
    env.LANG = 'en_US.UTF-8';

    this.port = await getPort();
    const childProcess = spawn('R', ['--quiet', '--slave', '-f', this.kernelScript, '--args', `port=${this.port}`],
      { cwd: this.cwd, env: env });
    childProcess.stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      console.log(`R stderr (${childProcess.pid}): ${str}`);
    });
    childProcess.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      console.log(`R stdout (${childProcess.pid}): ${str}`);
    });
    childProcess.on('exit', (code, signal) => {
      console.log(`R exited with code ${code}`);
    });
    this.process = childProcess;
  }

  public stop() {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
  }

  public async restart() {
    this.stop();
    await this.start();
  }

  public async eval(cell: vscode.NotebookCell): Promise<string> {
    if (this.process) {
      const client = net.createConnection({ port: this.port }, () => {
        console.log('connected to server!');
        const request = JSON.stringify({
          time: Date.now(),
          expr: cell.document.getText(),
        }).concat('\n');
        console.log(`Send: ${request}`);
        client.write(request);
      });

      client.on('end', () => {
        console.log('disconnected from server');
      });

      return new Promise((resolve, reject) => {
        client.on('data', (data) => {
          const response = data.toString();
          console.log(response);
          client.end();
          const output = JSON.parse(response);
          const result: string[] = output.result;
          resolve(result.join('\n'));
        });

        client.on('error', (err) => {
          reject(err.message);
        });
      });
    }
  }
}

class RNotebook implements vscode.Disposable {
  private kernel: RKernel;
  private disposables: vscode.Disposable[] = [];

  constructor(kernelScript: string, doc: vscode.NotebookDocument) {
    this.kernel = new RKernel(kernelScript, doc);
  }

  dispose() {
    this.kernel.stop();
  }

  public async restartKernel() {
    await vscode.commands.executeCommand('notebook.clearAllCellsOutputs');
    this.kernel.restart();
  }

  public async eval(cell: vscode.NotebookCell): Promise<string> {
    await this.kernel.start();
    return this.kernel.eval(cell);
  }
}

export class RNotebookProvider implements vscode.NotebookContentProvider, vscode.NotebookKernel {
  public label = 'R Kernel';
  public kernel = this;

  private kernelScript: string;
  private disposables: vscode.Disposable[] = [];
  private readonly notebooks = new Map<string, RNotebook>();

  constructor(kernelScript: string) {
    this.kernelScript = kernelScript;
    this.disposables.push(
      vscode.notebook.onDidOpenNotebookDocument(document => {
        const docKey = document.uri.toString();
        if (!this.notebooks.has(docKey)) {
          const notebook = new RNotebook(this.kernelScript, document);
          notebook.restartKernel();
          this.notebooks.set(docKey, notebook);
        }
      }),
      vscode.notebook.onDidCloseNotebookDocument(document => {
        const docKey = document.uri.toString();
        const notebook = this.notebooks.get(docKey);
        if (notebook) {
          notebook.dispose();
          this.notebooks.delete(docKey);
        }
      }),
    );
  }

  async openNotebook(uri: vscode.Uri): Promise<vscode.NotebookData> {
    const content = (await vscode.workspace.fs.readFile(uri)).toString();
    const lines = content.split(/\r?\n/);
    const cells: vscode.NotebookCellData[] = [];
    
    let line = 0;
    let cellType = 'markdown';
    let cellStartLine = 0;
    while (line < lines.length) {
      if (cellType === 'markdown') {
        if (lines[line].startsWith('---')) {
          cellType = 'yaml';
          cellStartLine = line;
        } else if (lines[line].startsWith('```{r')) {
          cells.push({
            cellKind: vscode.CellKind.Markdown,
            source: lines.slice(cellStartLine, line).join('\n'),
            language: 'markdown',
            outputs: [],
            metadata: {
              editable: true,
              runnable: false,
            },
          });
          cellType = 'r';
          cellStartLine = line;
        } else if (line === lines.length - 1) {
          cells.push({
            cellKind: vscode.CellKind.Markdown,
            source: lines.slice(cellStartLine, line).join('\n'),
            language: 'markdown',
            outputs: [],
            metadata: {
              editable: true,
              runnable: false,
            },
          });
        }
      } else if (cellType === 'yaml') {
        if (lines[line].startsWith('---')) {
          cells.push({
            cellKind: vscode.CellKind.Code,
            source: lines.slice(cellStartLine, line + 1).join('\n'),
            language: 'yaml',
            outputs: [],
            metadata: {
              editable: true,
              runnable: false,
            },
          });
          cellType = 'markdown';
          cellStartLine = line + 1;
        }
      } else if (cellType === 'r') {
        if (lines[line].startsWith('```')) {
          cells.push({
            cellKind: vscode.CellKind.Code,
            source: lines.slice(cellStartLine + 1, line).join('\n'),
            language: 'r',
            outputs: [],
            metadata: {
              editable: true,
              runnable: true,
            },
          });
          cellType = 'markdown';
          cellStartLine = line + 1;
        }
      }
      line++;
    }

    return {
      languages: ['r'],
      metadata: { },
      cells: cells,
    };
  }

  async save(document: vscode.NotebookDocument, targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
    let content = '';
    for (const cell of document.cells) {
      if (cancellation.isCancellationRequested) {
        return;
      }
      if (cell.cellKind === vscode.CellKind.Markdown) {
        content += cell.document.getText();
      } else if (cell.cellKind === vscode.CellKind.Code) {
        if (cell.language === 'r') {
          content += '```{r}\n' + cell.document.getText() + '\n```\n\n';
        } else if (cell.language === 'yaml') {
          content += '---\n' + cell.document.getText() + '\n---\n';
        } else {
          content += '```{' + cell.language + '}\n' + cell.document.getText() + '\n```\n\n';
        }
      }
    }
    await vscode.workspace.fs.writeFile(targetResource, Buffer.from(content));
  }

  onDidChangeNotebook = new vscode.EventEmitter<vscode.NotebookDocumentEditEvent>().event;

  async resolveNotebook(): Promise<void> { }

  async saveNotebook(document: vscode.NotebookDocument, cancellation: vscode.CancellationToken): Promise<void> {
    await this.save(document, document.uri, cancellation);
  }

  async saveNotebookAs(targetResource: vscode.Uri, document: vscode.NotebookDocument, cancellation: vscode.CancellationToken): Promise<void> {
    await this.save(document, targetResource, cancellation);
  }

  async backupNotebook(document: vscode.NotebookDocument, context: vscode.NotebookDocumentBackupContext, cancellation: vscode.CancellationToken): Promise<vscode.NotebookDocumentBackup> {
    await this.save(document, context.destination, cancellation);
    return {
      id: context.destination.toString(),
      delete: () => vscode.workspace.fs.delete(context.destination)
    };
  }

  async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell) {
    const notebook = this.notebooks.get(document.uri.toString());

    if (!cell) {  
      if (notebook) {
        notebook.restartKernel();
      }

      for (const cell of document.cells) {
        if (cell.cellKind === vscode.CellKind.Code && cell.metadata.runnable) {
          await this.executeCell(document, cell);
        }
      }

      return;
    }

    let output = '';
    let error: Error;

    if (notebook) {
      try {
        output = await notebook.eval(cell);
      } catch (e) {
        error = e;
      }
    }

    if (error) {
      cell.outputs = [{
        outputKind: vscode.CellOutputKind.Error,
        evalue: error.toString(),
        ename: '',
        traceback: [],
      }];
    } else {
      cell.outputs = [{
        outputKind: vscode.CellOutputKind.Text,
        text: output,
      }];
    }
  }

  async executeAllCells(document: vscode.NotebookDocument): Promise<void> {
    for (const cell of document.cells) {
      await this.executeCell(document, cell);
    }
  }

  async cancelCellExecution(document: vscode.NotebookDocument, cell: vscode.NotebookCell) {

  }

  async cancelAllCellsExecution(document: vscode.NotebookDocument) {

  }

  public dispose() {
    this.disposables.forEach(d => d.dispose());
  }
}
