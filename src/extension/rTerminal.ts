'use strict';

import * as path from 'path';
import * as os from 'os';
import { pathExists } from 'fs-extra';
import { isDeepStrictEqual } from 'util';

import * as vscode from 'vscode';

import * as util from './util';
import * as selection from './selection';
import { getSelection } from './selection';
import { removeSessionFiles } from './session';
import { config, delay, getRterm } from './util';
export let rTerm: vscode.Terminal;

export async function runSource(echo: boolean): Promise<void>  {
    const wad = vscode.window.activeTextEditor?.document;
    const isSaved = await util.saveDocument(wad);
    if (isSaved) {
        let rPath: string = util.ToRStringLiteral(wad.fileName, '"');
        let encodingParam = util.config().get<string>('source.encoding');
        encodingParam = `encoding = "${encodingParam}"`;
        rPath = [rPath, encodingParam].join(', ');
        if (echo) {
            rPath = [rPath, 'echo = TRUE'].join(', ');
        }
        void runTextInTerm(`source(${rPath})`);
    }
}

export async function knitRmd(echo: boolean, outputFormat: string): Promise<void>  {
    const wad: vscode.TextDocument = vscode.window.activeTextEditor.document;
    const isSaved = await util.saveDocument(wad);
    if (isSaved) {
        let rPath = util.ToRStringLiteral(wad.fileName, '"');
        let encodingParam = util.config().get<string>('source.encoding');
        encodingParam = `encoding = "${encodingParam}"`;
        rPath = [rPath, encodingParam].join(', ');
        if (echo) {
            rPath = [rPath, 'echo = TRUE'].join(', ');
        }
        if (outputFormat === undefined) {
            void runTextInTerm(`rmarkdown::render(${rPath})`);
        } else {
            void runTextInTerm(`rmarkdown::render(${rPath}, "${outputFormat}")`);
        }
    }
}

export async function runSelection(): Promise<void> {
    await runSelectionInTerm(true);
}

export async function runSelectionRetainCursor(): Promise<void> {
    await runSelectionInTerm(false);
}

export async function runSelectionOrWord(rFunctionName: string[]): Promise<void> {
    const text = selection.getWordOrSelection();
    const wrappedText = selection.surroundSelection(text, rFunctionName);
    await runTextInTerm(wrappedText);
}

export async function runCommandWithSelectionOrWord(rCommand: string): Promise<void>  {
    const text = selection.getWordOrSelection();
    const call = rCommand.replace(/\$\$/g, text);
    await runTextInTerm(call);
}

export async function runCommandWithEditorPath(rCommand: string): Promise<void>  {
    const wad: vscode.TextDocument = vscode.window.activeTextEditor.document;
    const isSaved = await util.saveDocument(wad);
    if (isSaved) {
        const rPath = util.ToRStringLiteral(wad.fileName, '');
        const call = rCommand.replace(/\$\$/g, rPath);
        await runTextInTerm(call);
    }
}

export async function runCommand(rCommand: string): Promise<void>  {
    await runTextInTerm(rCommand);
}

export async function runFromBeginningToLine(): Promise<void>  {
    const endLine = vscode.window.activeTextEditor.selection.end.line;
    const charactersOnLine = vscode.window.activeTextEditor.document.lineAt(endLine).text.length;
    const endPos = new vscode.Position(endLine, charactersOnLine);
    const range = new vscode.Range(new vscode.Position(0, 0), endPos);
    const text = vscode.window.activeTextEditor.document.getText(range);
    await runTextInTerm(text);
}

export async function runFromLineToEnd(): Promise<void>  {
    const startLine = vscode.window.activeTextEditor.selection.start.line;
    const startPos = new vscode.Position(startLine, 0);
    const endLine = vscode.window.activeTextEditor.document.lineCount;
    const range = new vscode.Range(startPos, new vscode.Position(endLine, 0));
    const text = vscode.window.activeTextEditor.document.getText(range);
    await runTextInTerm(text);
}


export async function createRTerm(preserveshow?: boolean): Promise<boolean> {
    const termName = 'R Interactive';
    const termPath = await getRterm();
    console.info(`termPath: ${termPath}`);
    if (termPath === undefined) {
        return undefined;
    }
    const termOpt: string[] = config().get('rterm.option');
    pathExists(termPath, (err, exists) => {
        if (exists) {
            const termOptions: vscode.TerminalOptions = {
                name: termName,
                shellPath: termPath,
                shellArgs: termOpt,
            };
            if (config().get<boolean>('sessionWatcher')) {
                termOptions.env = {
                    R_PROFILE_USER_OLD: process.env.R_PROFILE_USER,
                    R_PROFILE_USER: path.join(os.homedir(), '.vscode-R', '.Rprofile'),
                };
            }
            rTerm = vscode.window.createTerminal(termOptions);
            rTerm.show(preserveshow);

            return true;
        }
        void vscode.window.showErrorMessage('Cannot find R client.  Please check R path in preferences and reload.');

        return false;
    });
}

export async function restartRTerminal(): Promise<void>{
    if (typeof rTerm !== 'undefined'){
        rTerm.dispose();
        deleteTerminal(rTerm);
        await createRTerm(true);
    }
}

export function deleteTerminal(term: vscode.Terminal): void {
    if (isDeepStrictEqual(term, rTerm)) {
        rTerm = undefined;
        if (config().get<boolean>('sessionWatcher')) {
            removeSessionFiles();
        }
    }
}

export async function chooseTerminal(): Promise<vscode.Terminal> {
    if (config().get('alwaysUseActiveTerminal')) {
        if (vscode.window.terminals.length < 1) {
            void vscode.window.showInformationMessage('There are no open terminals.');

            return undefined;
        }

        return vscode.window.activeTerminal;
    }

    let msg = '[chooseTerminal] ';
    msg += `A. There are ${vscode.window.terminals.length} terminals: `;
    for (let i = 0; i < vscode.window.terminals.length; i++){
        msg += `Terminal ${i}: ${vscode.window.terminals[i].name} `;
    }
    if (vscode.window.terminals.length > 0) {
        const rTermNameOptions = ['R', 'R Interactive'];
        if (vscode.window.activeTerminal !== undefined) {
            const activeTerminalName = vscode.window.activeTerminal.name;
            if (rTermNameOptions.includes(activeTerminalName)) {
                return vscode.window.activeTerminal;
            }
            for (let i = vscode.window.terminals.length - 1; i >= 0; i--){
                const terminal = vscode.window.terminals[i];
                const terminalName = terminal.name;
                if (rTermNameOptions.includes(terminalName)) {
                    terminal.show(true);
                    return terminal;
                }
            }
        } else {
            msg += `B. There are ${vscode.window.terminals.length} terminals: `;
            for (let i = 0; i < vscode.window.terminals.length; i++){
                msg += `Terminal ${i}: ${vscode.window.terminals[i].name} `;
            }
            // Creating a terminal when there aren't any already does not seem to set activeTerminal
            if (vscode.window.terminals.length === 1) {
                const activeTerminalName = vscode.window.terminals[0].name;
                if (rTermNameOptions.includes(activeTerminalName)) {
                    return vscode.window.terminals[0];
                }
            } else {
                msg += `C. There are ${vscode.window.terminals.length} terminals: `;
                for (let i = 0; i < vscode.window.terminals.length; i++){
                    msg += `Terminal ${i}: ${vscode.window.terminals[i].name} `;
                }
                console.info(msg);
                void vscode.window.showErrorMessage('Error identifying terminal! Please run command "Developer: Toggle Developer Tools", find the message starting with "[chooseTerminal]", and copy the message to https://github.com/Ikuyadeu/vscode-R/issues');

                return undefined;
            }
        }
    }

    if (rTerm === undefined) {
        const success = await createRTerm(true);
        await delay(200); // Let RTerm warm up
        if (!success) {
            return undefined;
        }
    }

    return rTerm;
}

export async function runSelectionInTerm(moveCursor: boolean): Promise<void> {
    const selection = getSelection();
    if (moveCursor && selection.linesDownToMoveCursor > 0) {
        const lineCount = vscode.window.activeTextEditor.document.lineCount;
        if (selection.linesDownToMoveCursor + vscode.window.activeTextEditor.selection.end.line === lineCount) {
            const endPos = new vscode.Position(lineCount, vscode.window.activeTextEditor.document.lineAt(lineCount - 1).text.length);
            await vscode.window.activeTextEditor.edit(e => e.insert(endPos, '\n'));
        }
        await vscode.commands.executeCommand('cursorMove', { to: 'down', value: selection.linesDownToMoveCursor });
        await vscode.commands.executeCommand('cursorMove', { to: 'wrappedLineFirstNonWhitespaceCharacter' });
    }
    await runTextInTerm(selection.selectedText);
}

export async function runChunksInTerm(chunks: vscode.Range[]): Promise<void> {
    const text = chunks
        .map((chunk) => vscode.window.activeTextEditor.document.getText(chunk).trim())
        .filter((chunk) => chunk.length > 0)
        .join('\n');
    if (text.length > 0) {
        return runTextInTerm(text);
    }
}

export async function runTextInTerm(text: string): Promise<void> {
    const term = await chooseTerminal();
    if (term === undefined) {
        return;
    }
    if (config().get<boolean>('bracketedPaste')) {
        if (process.platform !== 'win32') {
            // Surround with ANSI control characters for bracketed paste mode
            text = `\x1b[200~${text}\x1b[201~`;
        }
        term.sendText(text);
    } else {
        const rtermSendDelay: number = config().get('rtermSendDelay');
        for (const line of text.split('\n')) {
            await delay(rtermSendDelay); // Increase delay if RTerm can't handle speed.
            term.sendText(line);
        }
    }
    setFocus(term);
}

function setFocus(term: vscode.Terminal) {
    const focus: string = config().get('source.focus');
    term.show(focus !== 'terminal');
}
