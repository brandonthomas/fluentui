// importAnalyzer.ts
import { Project, Node, SourceFile, ImportDeclaration, Symbol, TypeChecker, SyntaxKind } from 'ts-morph';
import { log } from './debugUtils.js';
import { TokenReference } from './types.js';
import { getModuleSourceFile } from './moduleResolver.js';
import { extractTokensFromCssVars } from './cssVarTokenExtractor.js';

/**
 * Represents a value imported from another module
 */
export interface ImportedValue {
  value: string;
  sourceFile: string;
  isLiteral: boolean;
}

/**
 * Analyzes imports in a source file to extract string values
 */
export async function analyzeImports(sourceFile: SourceFile, project: Project): Promise<Map<string, ImportedValue>> {
  const importedValues = new Map<string, ImportedValue>();
  const filePath = sourceFile.getFilePath();

  log(`Analyzing imports in ${filePath}`);

  // Get TypeScript's type checker
  const typeChecker = project.getTypeChecker();

  // Process all import declarations
  for (const importDecl of sourceFile.getImportDeclarations()) {
    try {
      // Process the import declaration
      await processImportDeclaration(importDecl, sourceFile, project, importedValues, typeChecker);
    } catch (err) {
      log(`Error processing import: ${importDecl.getModuleSpecifierValue()}`, err);
    }
  }

  return importedValues;
}

/**
 * Process a single import declaration
 */
async function processImportDeclaration(
  importDecl: ImportDeclaration,
  sourceFile: SourceFile,
  project: Project,
  importedValues: Map<string, ImportedValue>,
  typeChecker: TypeChecker,
): Promise<void> {
  const moduleSpecifier = importDecl.getModuleSpecifierValue();
  const containingFilePath = sourceFile.getFilePath();

  // Use our module resolver to get the imported file
  const importedFile = getModuleSourceFile(project, moduleSpecifier, containingFilePath);

  if (!importedFile) {
    log(`Could not resolve module: ${moduleSpecifier}`);
    return;
  }

  // Process named imports (import { x } from 'module')
  processNamedImports(importDecl, importedFile, project, importedValues, typeChecker);

  // Process default import (import x from 'module')
  processDefaultImport(importDecl, importedFile, project, importedValues, typeChecker);
}

/**
 * Process named imports using TypeScript's type checker to follow re-exports
 */
function processNamedImports(
  importDecl: ImportDeclaration,
  importedFile: SourceFile,
  project: Project,
  importedValues: Map<string, ImportedValue>,
  typeChecker: TypeChecker,
): void {
  for (const namedImport of importDecl.getNamedImports()) {
    const importName = namedImport.getName();
    const alias = namedImport.getAliasNode()?.getText() || importName;

    // Find the export's true source using TypeScript's type checker
    const exportInfo = findExportDeclaration(importedFile, importName, typeChecker);

    if (exportInfo) {
      const { declaration, sourceFile: declarationFile } = exportInfo;

      // Extract the value from the declaration
      const valueInfo = extractValueFromDeclaration(declaration);

      if (valueInfo) {
        importedValues.set(alias, {
          value: valueInfo.value,
          sourceFile: declarationFile.getFilePath(),
          isLiteral: valueInfo.isLiteral,
        });

        log(`Added imported value: ${alias} = ${valueInfo.value} from ${declarationFile.getFilePath()}`);
      }
    }
  }
}

/**
 * Process default import using TypeScript's type checker
 */
function processDefaultImport(
  importDecl: ImportDeclaration,
  importedFile: SourceFile,
  project: Project,
  importedValues: Map<string, ImportedValue>,
  typeChecker: TypeChecker,
): void {
  const defaultImport = importDecl.getDefaultImport();
  if (!defaultImport) {
    return;
  }

  const importName = defaultImport.getText();

  // Find the default export's true source
  const exportInfo = findExportDeclaration(importedFile, 'default', typeChecker);

  if (exportInfo) {
    const { declaration, sourceFile: declarationFile } = exportInfo;

    // Extract the value from the declaration
    const valueInfo = extractValueFromDeclaration(declaration);

    if (valueInfo) {
      importedValues.set(importName, {
        value: valueInfo.value,
        sourceFile: declarationFile.getFilePath(),
        isLiteral: valueInfo.isLiteral,
      });

      log(`Added default import: ${importName} = ${valueInfo.value} from ${declarationFile.getFilePath()}`);
    }
  }
}

/**
 * Find an export's original declaration using TypeScript's type checker
 */
function findExportDeclaration(
  sourceFile: SourceFile,
  exportName: string,
  typeChecker: TypeChecker,
): { declaration: Node; sourceFile: SourceFile } | undefined {
  try {
    // Get the source file's symbol (represents the module)
    const sourceFileSymbol = typeChecker.getSymbolAtLocation(sourceFile);
    if (!sourceFileSymbol) {
      log(`No symbol found for source file ${sourceFile.getFilePath()}`);
      return undefined;
    }

    // Get all exports from this module
    const exports = typeChecker.getExportsOfModule(sourceFileSymbol);
    if (!exports || exports.length === 0) {
      log(`No exports found in module ${sourceFile.getFilePath()}`);
      return undefined;
    }

    // Find the specific export we're looking for
    const exportSymbol = exports.find((symbol: Symbol) => symbol.getName() === exportName);
    if (!exportSymbol) {
      log(`Export symbol '${exportName}' not found in ${sourceFile.getFilePath()}`);
      return undefined;
    }

    // If this is an alias (re-export), get the original symbol
    let resolvedSymbol: Symbol = exportSymbol;
    if (exportSymbol.isAlias()) {
      // we're ok type casting here because we know the symbol is an alias from the previous check but TS won't pick up on it
      resolvedSymbol = typeChecker.getAliasedSymbol(exportSymbol) as Symbol;
      log(`Resolved alias to: ${resolvedSymbol.getName()}`);
    }

    // Get the value declaration from the resolved symbol
    const valueDeclaration = resolvedSymbol.getValueDeclaration();
    if (!valueDeclaration) {
      log(`No value declaration found for ${exportName}`);

      // Fallback to any declaration if value declaration is not available
      const declarations = resolvedSymbol.getDeclarations();
      if (!declarations || declarations.length === 0) {
        log(`No declarations found for ${exportName}`);
        return undefined;
      }

      const declaration = declarations[0];
      const declarationSourceFile = declaration.getSourceFile();

      return {
        declaration,
        sourceFile: declarationSourceFile,
      };
    }

    const declarationSourceFile = valueDeclaration.getSourceFile();

    log(
      `Found declaration for '${exportName}': ${valueDeclaration.getKindName()} in ${declarationSourceFile.getFilePath()}`,
    );
    return {
      declaration: valueDeclaration,
      sourceFile: declarationSourceFile,
    };
  } catch (err) {
    log(`Error finding export declaration for ${exportName}:`, err);
    return undefined;
  }
}

/**
 * Extract string value from a declaration node
 */
function extractValueFromDeclaration(declaration: Node): { value: string; isLiteral: boolean } | undefined {
  // Handle variable declarations
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return extractValueFromExpression(initializer);
  }
  // Handle export assignments (export default "value")
  if (Node.isExportAssignment(declaration)) {
    const expression = declaration.getExpression();
    return extractValueFromExpression(expression);
  }

  // Handle named exports (export { x })
  if (Node.isExportSpecifier(declaration)) {
    // Find the local symbol this specifier refers to
    const name = declaration.getNameNode().getText();
    const sourceFile = declaration.getSourceFile();

    // Find the local declaration with this name
    for (const varDecl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (varDecl.getName() === name) {
        const initializer = varDecl.getInitializer();
        return extractValueFromExpression(initializer);
      }
    }
  }

  return undefined;
}

/**
 * Extract value from an expression node
 */
function extractValueFromExpression(expression: Node | undefined): { value: string; isLiteral: boolean } | undefined {
  if (!expression) {
    return undefined;
  }

  // we are looking for a variableDeclaration and we need to resolve these to their root if they have tokens in them recursively

  if (Node.isStringLiteral(expression)) {
    return {
      value: expression.getLiteralValue(),
      isLiteral: true,
    };
  } else if (Node.isTemplateExpression(expression)) {
    // We need to process template expression spans and then if they are also themselves something like a template expression or variable declartion, resolve that recursively.
    console.log(expression.getTemplateSpans().map(span => span.getText()));

    return {
      value: expression.getText(),
      isLiteral: Node.isTemplateExpression(expression),
    };
  } else if (Node.isPropertyAccessExpression(expression)) {
    return {
      value: expression.getText(),
      isLiteral: Node.isTemplateExpression(expression),
    };
  } else if (Node.isNoSubstitutionTemplateLiteral(expression)) {
    return {
      value: expression.getLiteralValue(),
      isLiteral: true,
    };
  }

  return undefined;
}

/**
 * Process string tokens in imported values
 */
export function processImportedStringTokens(
  importedValues: Map<string, ImportedValue>,
  propertyName: string,
  value: string,
  path: string[] = [],
  TOKEN_REGEX: RegExp,
): TokenReference[] {
  const tokens: TokenReference[] = [];

  // Check if the value is an imported value reference
  if (importedValues.has(value)) {
    const importedValue = importedValues.get(value)!;

    if (importedValue.isLiteral) {
      // Process literal values (strings and template literals)

      // First, check for direct token references
      const matches = importedValue.value.match(TOKEN_REGEX);
      if (matches) {
        matches.forEach(match => {
          tokens.push({
            property: propertyName,
            token: match,
            path,
            isVariableReference: true,
            sourceFile: importedValue.sourceFile,
          });
        });
      } else if (importedValue.value.includes('var(')) {
        // Then check for CSS variable patterns that might contain tokens
        const cssVarTokens = extractTokensFromCssVars(importedValue.value, propertyName, path, TOKEN_REGEX);

        // Add CSS variable tokens with the source information
        cssVarTokens.forEach(token => {
          tokens.push({
            ...token,
            isVariableReference: true,
            sourceFile: importedValue.sourceFile,
          });
        });
      }
    } else {
      // Process non-literal values (property access expressions, etc.)

      // Check if the value directly matches the token pattern (tokens.someToken)
      const matches = importedValue.value.match(TOKEN_REGEX);
      if (importedValue.value.match(TOKEN_REGEX)) {
        tokens.push({
          property: propertyName,
          token: importedValue.value,
          path,
          isVariableReference: true,
          sourceFile: importedValue.sourceFile,
        });
      } else if (matches) {
        // For template expressions, we might need to extract tokens from parts of the expression
        // This is a simplified approach - might need enhancement for complex template expressions
        matches.forEach(match => {
          tokens.push({
            property: propertyName,
            token: match,
            path,
            isVariableReference: true,
            sourceFile: importedValue.sourceFile,
          });
        });
      }
    }
  }

  return tokens;
}
