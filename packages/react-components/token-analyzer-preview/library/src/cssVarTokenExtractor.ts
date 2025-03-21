// cssVarTokenExtractor.ts
import { log } from './debugUtils.js';
import { TokenReference } from './types.js';

/**
 * Extracts token references from CSS variable syntax including nested fallback chains
 * Example: var(--some-token, var(--fallback, var(${tokens.someToken})))
 *
 * @param value The CSS variable string to process
 * @param propertyName The CSS property name this value is assigned to
 * @param path The path in the style object
 * @param TOKEN_REGEX The regex pattern to match token references
 * @returns Array of token references found in the string
 */
export function extractTokensFromCssVars(
  value: string,
  propertyName: string,
  path: string[] = [],
  TOKEN_REGEX: RegExp,
): TokenReference[] {
  const tokens: TokenReference[] = [];

  // Direct token matches in the string
  const directMatches = value.match(TOKEN_REGEX);
  if (directMatches) {
    directMatches.forEach(match => {
      tokens.push({
        property: propertyName,
        token: match,
        path,
      });
    });
  }

  // Look for CSS var() patterns
  const varPattern = /var\s*\(\s*([^,)]*),?\s*(.*?)\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = varPattern.exec(value)) !== null) {
    const fullMatch = match[0]; // The entire var(...) expression
    const varName = match[1]; // The CSS variable name
    const fallback = match[2]; // The fallback value, which might contain nested var() calls

    log(`Processing CSS var: ${fullMatch}`);
    log(`  - Variable name: ${varName}`);
    log(`  - Fallback: ${fallback}`);

    // Check if the variable name contains a token reference
    const varNameTokens = varName.match(TOKEN_REGEX);
    if (varNameTokens) {
      varNameTokens.forEach(token => {
        tokens.push({
          property: propertyName,
          token,
          path,
        });
      });
    }

    // If there's a fallback value, it might contain tokens or nested var() calls
    if (fallback) {
      // Recursively process the fallback
      if (fallback.includes('var(')) {
        const fallbackTokens = extractTokensFromCssVars(fallback, propertyName, path, TOKEN_REGEX);
        tokens.push(...fallbackTokens);
      } else {
        // Check for direct token references in the fallback
        const fallbackTokens = fallback.match(TOKEN_REGEX);
        if (fallbackTokens) {
          fallbackTokens.forEach(token => {
            tokens.push({
              property: propertyName,
              token,
              path,
            });
          });
        }
      }
    }
  }

  return tokens;
}
