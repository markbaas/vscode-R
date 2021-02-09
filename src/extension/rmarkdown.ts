import {
  CancellationToken, CodeLens, CodeLensProvider,
  CompletionItem, CompletionItemProvider,
  Event, EventEmitter, Position, Range, TextDocument, TextEditorDecorationType, window, Selection
} from 'vscode';
import { runChunksInTerm } from './rTerminal';
import { config } from './util';

function isChunkStartLine(text: string) {
  if (text.match(/^\s*```+\s*\{\w+\s*.*$/g)) {
    return true;
  }
  return false;
}

function isChunkEndLine(text: string) {
  if (text.match(/^\s*```+\s*$/g)) {
    return true;
  }
  return false;
}

function getChunkLanguage(text: string) {
  return text.replace(/^\s*```+\s*\{(\w+)\s*.*\}\s*$/g, '$1').toLowerCase();
}

function getChunkOptions(text: string) {
  return text.replace(/^\s*```+\s*\{\w+\s*,?\s*(.*)\s*\}\s*$/g, '$1');
}

function getChunkEval(chunkOptions: string) {
  if (chunkOptions.match(/eval\s*=\s*(F|FALSE)/g)) {
    return false;
  }
  return true;
}

export class RMarkdownCodeLensProvider implements CodeLensProvider {
  private codeLenses: CodeLens[] = [];
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  private readonly decoration: TextEditorDecorationType;
  public readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    this.decoration = window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: config().get('rmarkdown.chunkBackgroundColor'),
    });
  }

  public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
    this.codeLenses = [];
    const chunks = getChunks(document);
    const chunkRanges: Range[] = [];
    const rmdCodeLensCommands: string[] = config().get('rmarkdown.codeLensCommands');

    // Iterate through all code chunks for getting chunk information for both CodeLens and chunk background color (set by `editor.setDecorations`)
    for (let i = 1 ; i <= chunks.length ; i++) {
      const chunk = chunks.filter(e => e.id === i)[0];
      const chunkRange = chunk.chunkRange;
      const line = chunk.startLine;
      chunkRanges.push(chunkRange);

      // Enable/disable only CodeLens, without affecting chunk background color.
      if (config().get<boolean>('rmarkdown.enableCodeLens') && chunk.language === 'r') {
        if (token.isCancellationRequested) {
          break;
        }
        this.codeLenses.push(
          new CodeLens(chunkRange, {
            title: 'Run Chunk',
            tooltip: 'Run current chunk',
            command: 'r.runCurrentChunk',
            arguments: [chunks, line]
          }),
          new CodeLens(chunkRange, {
            title: 'Run Above',
            tooltip: 'Run all chunks above',
            command: 'r.runAboveChunks',
            arguments: [chunks, line]
          }),
          new CodeLens(chunkRange, {
            title: 'Run Current & Below',
            tooltip: 'Run current and all chunks below',
            command: 'r.runCurrentAndBelowChunks',
            arguments: [chunks, line]
          }),
          new CodeLens(chunkRange, {
            title: 'Run Below',
            tooltip: 'Run all chunks below',
            command: 'r.runBelowChunks',
            arguments: [chunks, line]
          }),
          new CodeLens(chunkRange, {
            title: 'Run Previous',
            tooltip: 'Run previous chunk',
            command: 'r.runPreviousChunk',
            arguments: [chunks, line]
          }),
          new CodeLens(chunkRange, {
            title: 'Run Next',
            tooltip: 'Run next chunk',
            command: 'r.runNextChunk',
            arguments: [chunks, line]
          }),
          new CodeLens(chunkRange, {
            title: 'Run All',
            tooltip: 'Run all chunks',
            command: 'r.runAllChunks',
            arguments: [chunks]
          }),
          new CodeLens(chunkRange, {
            title: 'Go Previous',
            tooltip: 'Go to previous chunk',
            command: 'r.goToPreviousChunk',
            arguments: [chunks, line]
          }),
          new CodeLens(chunkRange, {
            title: 'Go Next',
            tooltip: 'Go to next chunk',
            command: 'r.goToNextChunk',
            arguments: [chunks, line]
          }),
          new CodeLens(chunkRange, {
            title: 'Select Chunk',
            tooltip: 'Select current chunk',
            command: 'r.selectCurrentChunk',
            arguments: [chunks, line]
          }),
        );
      }
    }

    for (const editor of window.visibleTextEditors) {
      if (editor.document.uri.toString() === document.uri.toString()) {
        editor.setDecorations(this.decoration, chunkRanges);
      }
    }

    // For default options, both options and sort order are based on options specified in package.json.
    // For user-specified options, both options and sort order are based on options specified in settings UI or settings.json.
    return this.codeLenses.
      filter(e => rmdCodeLensCommands.includes(e.command.command)).
      sort(function(a, b) {
        const sorted = rmdCodeLensCommands.indexOf(a.command.command) -
                       rmdCodeLensCommands.indexOf(b.command.command);
        return sorted;
      });
  }
  public resolveCodeLens(codeLens: CodeLens): CodeLens {
    return codeLens;
  }
}

interface RMarkdownChunk {
  id: number;
  startLine: number;
  endLine: number;
  language: string;
  options: string;
  eval: boolean;
  chunkRange: Range;
  codeRange: Range;
}

// Scan document and return chunk info (e.g. ID, chunk range) from all chunks
function getChunks(document: TextDocument): RMarkdownChunk[] {
  const lines = document.getText().split(/\r?\n/);
  const chunks: RMarkdownChunk[] = [];

  let line = 0;

  let chunkId = 0;  // One-based index
  let chunkStartLine: number = undefined;
  let chunkEndLine: number = undefined;
  let chunkLanguage: string = undefined;
  let chunkOptions: string = undefined;
  let chunkEval: boolean = undefined;

  while (line < lines.length) {
    if (chunkStartLine === undefined) {
      if (isChunkStartLine(lines[line])) {
        chunkId++;
        chunkStartLine = line;
        chunkLanguage = getChunkLanguage(lines[line]);
        chunkOptions = getChunkOptions(lines[line]);
        chunkEval = getChunkEval(chunkOptions);
      }
    } else {
      if (isChunkEndLine(lines[line])) {
        chunkEndLine = line;

        const chunkRange = new Range(
          new Position(chunkStartLine, 0),
          new Position(line, lines[line].length)
        );
        const codeRange = new Range(
          new Position(chunkStartLine + 1, 0),
          new Position(line - 1, lines[line - 1].length)
        );

        chunks.push({
          id: chunkId, // One-based index
          startLine: chunkStartLine,
          endLine: chunkEndLine,
          language: chunkLanguage,
          options: chunkOptions,
          eval: chunkEval,
          chunkRange: chunkRange,
          codeRange: codeRange
        });

        chunkStartLine = undefined;
        }
      }
      line++;
    }
  return chunks;
}

function getCurrentChunk(chunks: RMarkdownChunk[], line: number): RMarkdownChunk {
  const lines = window.activeTextEditor.document.getText().split(/\r?\n/);

  let chunkStartLineAtOrAbove = line;
  // `- 1` to cover edge case when cursor is at 'chunk end line'
  let chunkEndLineAbove = line - 1;

  while (chunkStartLineAtOrAbove >= 0 && !isChunkStartLine(lines[chunkStartLineAtOrAbove])) {
    chunkStartLineAtOrAbove--;
  }

  while (chunkEndLineAbove >= 0 && !isChunkEndLine(lines[chunkEndLineAbove])) {
    chunkEndLineAbove--;
  }

  // Case: Cursor is within chunk
  if (chunkEndLineAbove < chunkStartLineAtOrAbove) {
    line = chunkStartLineAtOrAbove;
  } else {
  // Cases: Cursor is above the first chunk, at the first chunk or outside of chunk. Find the 'chunk start line' of the next chunk below the cursor.
    let chunkStartLineBelow = line + 1;
    while (!isChunkStartLine(lines[chunkStartLineBelow])) {
      chunkStartLineBelow++;
    }
    line = chunkStartLineBelow;
  }
  const currentChunk = chunks.filter(i => i.startLine === line)[0];
  return currentChunk;
}

// Alternative `getCurrentChunk` for cases:
// - commands (e.g. `selectCurrentChunk`) only make sense when cursor is within chunk
// - when cursor is outside of chunk, no response is triggered for chunk navigation commands (e.g. `goToPreviousChunk`) and chunk running commands (e.g. `runAboveChunks`)
function getCurrentChunk__CursorWithinChunk(chunks: RMarkdownChunk[], line: number): RMarkdownChunk {
  const ids = chunks.map(e => e.id);

  for (const id of ids) {
    const chunk = chunks.filter(e => e.id === id)[0];
    if (chunk.startLine <= line && line <= chunk.endLine) {
      return chunk;
    }
  }
}

function getPreviousChunk(chunks: RMarkdownChunk[], line: number): RMarkdownChunk {
  const currentChunk = getCurrentChunk(chunks, line);
  // When cursor is below the last 'chunk end line', the definition of the previous chunk is the last chunk
  const previousChunkId = currentChunk.endLine < line ? currentChunk.id : currentChunk.id - 1;
  const previousChunk = chunks.filter(i => i.id === previousChunkId)[0];
  return previousChunk;
}

function getNextChunk(chunks: RMarkdownChunk[], line: number): RMarkdownChunk {
  const currentChunk = getCurrentChunk(chunks, line);
  // When cursor is above the first 'chunk start line', the definition of the next chunk is the first chunk
  const nextChunkId = line < currentChunk.startLine ? currentChunk.id : currentChunk.id + 1;
  const nextChunk = chunks.filter(i => i.id === nextChunkId)[0];
  return nextChunk;
}

// Helpers
function _getChunks() {
  return getChunks(window.activeTextEditor.document);
}
function _getStartLine() {
  return window.activeTextEditor.selection.start.line;
}

export async function runCurrentChunk(chunks: RMarkdownChunk[] = _getChunks(),
                                      line: number = _getStartLine()): Promise<void> {
  const currentChunk = getCurrentChunk(chunks, line);
  await runChunksInTerm([currentChunk.codeRange]);
}

export async function runPreviousChunk(chunks: RMarkdownChunk[] = _getChunks(),
                                       line: number = _getStartLine()): Promise<void> {
  const previousChunk = getPreviousChunk(chunks, line);
  await runChunksInTerm([previousChunk.codeRange]);
}

export async function runNextChunk(chunks: RMarkdownChunk[] = _getChunks(),
                                   line: number = _getStartLine()): Promise<void> {
  const nextChunk = getNextChunk(chunks, line);
  await runChunksInTerm([nextChunk.codeRange]);
}

export async function runAboveChunks(chunks: RMarkdownChunk[] = _getChunks(),
                                     line: number = _getStartLine()): Promise<void> {
  const previousChunk = getPreviousChunk(chunks, line);
  const firstChunkId = 1;
  const previousChunkId = previousChunk.id;

  const codeRanges: Range[] = [];

  for (let i = firstChunkId ; i <= previousChunkId ; i++) {
    const chunk = chunks.filter(e => e.id === i)[0];
    codeRanges.push(chunk.codeRange);
  }
  await runChunksInTerm(codeRanges);
}

export async function runBelowChunks(chunks: RMarkdownChunk[] = _getChunks(),
                                     line: number = _getStartLine()): Promise<void> {

  const nextChunk = getNextChunk(chunks, line);
  const nextChunkId = nextChunk.id;
  const lastChunkId = chunks.length;

  const codeRanges: Range[] = [];

  for (let i = nextChunkId ; i <= lastChunkId ; i++) {
    const chunk = chunks.filter(e => e.id === i)[0];
    codeRanges.push(chunk.codeRange);
  }
  await runChunksInTerm(codeRanges);
}

export async function runCurrentAndBelowChunks(chunks: RMarkdownChunk[] = _getChunks(),
                                               line: number = _getStartLine()): Promise<void> {
  const currentChunk = getCurrentChunk(chunks, line);
  const currentChunkId = currentChunk.id;
  const lastChunkId = chunks.length;

  const codeRanges: Range[] = [];

  for (let i = currentChunkId ; i <= lastChunkId ; i++) {
    const chunk = chunks.filter(e => e.id === i)[0];
    codeRanges.push(chunk.codeRange);
  }
  await runChunksInTerm(codeRanges);
}

export async function runAllChunks(chunks: RMarkdownChunk[] = _getChunks()): Promise<void> {

  const firstChunkId = 1;
  const lastChunkId = chunks.length;

  const codeRanges: Range[] = [];

  for (let i = firstChunkId ; i <= lastChunkId ; i++) {
    const chunk = chunks.filter(e => e.id === i)[0];
    codeRanges.push(chunk.codeRange);
  }
  await runChunksInTerm(codeRanges);
}

function goToChunk(chunk: RMarkdownChunk) {
  // Move cursor 1 line below 'chunk start line'
  const line = chunk.startLine + 1;
  window.activeTextEditor.selection = new Selection(line, 0, line, 0);
}

export function goToPreviousChunk(chunks: RMarkdownChunk[] = _getChunks(),
                                        line: number = _getStartLine()): void {
  const previousChunk = getPreviousChunk(chunks, line);
  goToChunk(previousChunk);
}

export function goToNextChunk(chunks: RMarkdownChunk[] = _getChunks(),
                                    line: number = _getStartLine()): void {
  const nextChunk = getNextChunk(chunks, line);
  goToChunk(nextChunk);
}

export function selectCurrentChunk(chunks: RMarkdownChunk[] = _getChunks(),
                                         line: number = _getStartLine()): void {
  const editor = window.activeTextEditor;
  const currentChunk = getCurrentChunk__CursorWithinChunk(chunks, line);
  const lines = editor.document.getText().split(/\r?\n/);

  editor.selection = new Selection(
    currentChunk.startLine, 0,
    currentChunk.endLine, lines[currentChunk.endLine].length
  );
}

export class RMarkdownCompletionItemProvider implements CompletionItemProvider {

  // obtained from R code
  // paste0("[", paste0(paste0("'", names(knitr:: opts_chunk$merge(NULL)), "'"), collapse = ", "), "]")
  public readonly chunkOptions = ['eval', 'echo', 'results', 'tidy', 'tidy.opts', 'collapse',
    'prompt', 'comment', 'highlight', 'strip.white', 'size', 'background',
    'cache', 'cache.path', 'cache.vars', 'cache.lazy', 'dependson',
    'autodep', 'cache.rebuild', 'fig.keep', 'fig.show', 'fig.align',
    'fig.path', 'dev', 'dev.args', 'dpi', 'fig.ext', 'fig.width',
    'fig.height', 'fig.env', 'fig.cap', 'fig.scap', 'fig.lp', 'fig.subcap',
    'fig.pos', 'out.width', 'out.height', 'out.extra', 'fig.retina',
    'external', 'sanitize', 'interval', 'aniopts', 'warning', 'error',
    'message', 'render', 'ref.label', 'child', 'engine', 'split',
    'include', 'purl'];
  public readonly chunkOptionCompletionItems: CompletionItem[];

  constructor() {
    this.chunkOptionCompletionItems = this.chunkOptions.map((x: string) => {
      const item = new CompletionItem(`${x}`);
      item.insertText = `${x}=`;
      return item;
    });
  }

  public provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    const line = document.lineAt(position).text;
    if (isChunkStartLine(line) && getChunkLanguage(line) === 'r') {
      return this.chunkOptionCompletionItems;
    }

    return undefined;
  }
}
