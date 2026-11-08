import ts from 'typescript';
import {
  MAX_CODE_MAP_IMPORTS_PER_FILE,
  MAX_CODE_MAP_NAME_LENGTH,
  MAX_CODE_MAP_SPECIFIER_LENGTH,
  MAX_CODE_MAP_SYMBOLS_PER_FILE,
  type CodeMapImportKind,
  type CodeMapImportSpec,
  type CodeMapSymbol,
  type CodeMapSymbolKind,
} from '@acp/core';

/**
 * Symbols and import specifiers of one TS/JS file (ADR-0034 §2), with `ts.createSourceFile` only:
 * no Program, no type checker, no module resolution, nothing executed. The result holds names,
 * kinds, lines and import specifiers; never source text, comments or other string literals.
 */

export interface ParsedSource {
  symbols: CodeMapSymbol[];
  imports: CodeMapImportSpec[];
}

/** Injectable so tests can count parses (unchanged blobs must never be parsed again). */
export type SourceParser = (path: string, text: string) => ParsedSource;

function scriptKindOf(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(m|c)?js$/.test(lower)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function modifiersOf(node: ts.Node): readonly ts.ModifierLike[] {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiersOf(node).some((m) => m.kind === kind);
}

/** A string literal's text, for specifiers only. */
function specifierOf(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return null;
  const text = node.text;
  return text.length >= 1 && text.length <= MAX_CODE_MAP_SPECIFIER_LENGTH ? text : null;
}

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, out);
  }
}

function variableKind(list: ts.VariableDeclarationList): CodeMapSymbolKind {
  const flags = list.flags;
  if (flags & ts.NodeFlags.Let) return 'let';
  // `const`, and `using` / `await using`, which are const bindings too.
  if (flags & (ts.NodeFlags.Const | ts.NodeFlags.Using)) return 'const';
  return 'var';
}

export const parseScript: SourceParser = (path, text) => {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, scriptKindOf(path));
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const symbols: CodeMapSymbol[] = [];
  const seen = new Set<string>();
  const exportedNames = new Set<string>();
  const add = (name: string, kind: CodeMapSymbolKind, node: ts.Node, exported: boolean): void => {
    if (name.length === 0 || name.length > MAX_CODE_MAP_NAME_LENGTH) return;
    // Overloads and merged declarations are one symbol (the first declaration's line).
    const key = `${kind}\0${name}`;
    if (seen.has(key)) {
      if (exported) {
        const prior = symbols.find((s) => s.kind === kind && s.name === name);
        if (prior) prior.exported = true;
      }
      return;
    }
    seen.add(key);
    symbols.push({ name, kind, line: lineOf(node), exported });
  };

  for (const stmt of sf.statements) {
    const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(stmt)) {
      const name = stmt.name?.text ?? (isDefault ? 'default' : null);
      if (name !== null) add(name, 'function', stmt, exported);
    } else if (ts.isClassDeclaration(stmt)) {
      const name = stmt.name?.text ?? (isDefault ? 'default' : null);
      if (name !== null) add(name, 'class', stmt, exported);
    } else if (ts.isInterfaceDeclaration(stmt)) {
      add(stmt.name.text, 'interface', stmt, exported);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      add(stmt.name.text, 'type', stmt, exported);
    } else if (ts.isEnumDeclaration(stmt)) {
      add(stmt.name.text, 'enum', stmt, exported);
    } else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
      // `namespace X {}`; never `declare module 'x'` (a string, not a symbol) or `declare global`.
      if (!(stmt.flags & ts.NodeFlags.GlobalAugmentation)) {
        add(stmt.name.text, 'namespace', stmt, exported);
      }
    } else if (ts.isVariableStatement(stmt)) {
      const kind = variableKind(stmt.declarationList);
      for (const decl of stmt.declarationList.declarations) {
        const names: string[] = [];
        bindingNames(decl.name, names);
        for (const name of names) add(name, kind, decl, exported);
      }
    } else if (ts.isExportDeclaration(stmt)) {
      // `export { a, b as c }` without `from` marks local declarations as exported.
      if (
        stmt.moduleSpecifier === undefined &&
        stmt.exportClause !== undefined &&
        ts.isNamedExports(stmt.exportClause)
      ) {
        for (const el of stmt.exportClause.elements) {
          exportedNames.add((el.propertyName ?? el.name).text);
        }
      }
    } else if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      // `export default x` and `export = x`.
      exportedNames.add(stmt.expression.text);
    }
  }
  for (const s of symbols) if (exportedNames.has(s.name)) s.exported = true;

  const imports: CodeMapImportSpec[] = [];
  const addImport = (specifier: string | null, kind: CodeMapImportKind): void => {
    if (specifier !== null && imports.length < MAX_CODE_MAP_IMPORTS_PER_FILE) {
      imports.push({ specifier, kind });
    }
  };
  // An explicit stack: deeply nested generated code must not overflow the call stack.
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const node = stack.pop() as ts.Node;
    if (ts.isImportDeclaration(node)) {
      addImport(specifierOf(node.moduleSpecifier), 'import');
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) {
        addImport(specifierOf(node.moduleSpecifier), 'export-from');
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addImport(specifierOf(node.moduleReference.expression), 'require');
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'require') {
        addImport(specifierOf(node.arguments[0]), 'require');
      } else if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        addImport(specifierOf(node.arguments[0]), 'dynamic');
      }
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    // Reversed so the pop order follows the source order.
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as ts.Node);
  }

  return { symbols: symbols.slice(0, MAX_CODE_MAP_SYMBOLS_PER_FILE), imports };
};
