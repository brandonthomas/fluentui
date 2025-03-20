// cssVarE2E.test.ts
import { Project } from 'ts-morph';
import { analyzeFile } from '../astAnalyzer.js';
import * as path from 'path';
import * as fs from 'fs/promises';

// Test file contents
const cssVarsStyleFile = `
import { makeStyles } from '@griffel/react';
import { tokens } from '@fluentui/react-theme';
import { colorPrimary, colorSecondary, nestedFallbackVar, complexCssVar } from './tokenVars';

const useStyles = makeStyles({
  // Direct token reference
  direct: {
    color: tokens.colorNeutralForeground1,
  },
  // CSS variable with token
  cssVar: {
    color: \`var(--theme-color, \${tokens.colorBrandForeground1})\`,
  },
  // Imported direct token
  importedToken: {
    color: colorPrimary,
  },
  // Imported CSS variable with token
  importedCssVar: {
    color: colorSecondary,
  },
  // Nested CSS variable with token
  nestedCssVar: {
    color: \`var(--primary, var(--secondary, \${tokens.colorBrandForeground2}))\`,
  },
  // Imported nested CSS variable with token
  importedNestedVar: {
    color: nestedFallbackVar,
  },
  // Imported complex CSS variable with multiple tokens
  importedComplexVar: {
    color: complexCssVar,
  },
});
`;

const tokenVarsFile = `
import { tokens } from '@fluentui/react-theme';
// Direct token exports
export const colorPrimary = tokens.colorBrandForeground1;
export const colorSecondary = \`var(--color, \${tokens.colorBrandForeground2})\`;

// Nested fallback vars
export const nestedFallbackVar = \`var(--a, var(--b, \${tokens.colorNeutralForeground3}))\`;

// Complex vars with multiple tokens
export const complexCssVar = \`var(--complex, var(--nested, \${tokens.colorBrandBackground})) var(--another, \${tokens.colorNeutralBackground1})\`;
`;

describe('CSS Variable Token Extraction E2E', () => {
  let project: Project;
  let tempDir: string;
  let stylesFilePath: string;
  let varsFilePath: string;

  beforeAll(async () => {
    // Create temp directory for test files
    tempDir = path.join(__dirname, 'temp-e2e-test');
    await fs.mkdir(tempDir, { recursive: true });

    // Create test files
    stylesFilePath = path.join(tempDir, 'test.styles.ts');
    varsFilePath = path.join(tempDir, 'tokenVars.ts');

    await fs.writeFile(stylesFilePath, cssVarsStyleFile);
    await fs.writeFile(varsFilePath, tokenVarsFile);

    // Initialize project
    project = new Project({
      tsConfigFilePath: path.join(tempDir, '../../../tsconfig.json'),
      skipAddingFilesFromTsConfig: true,
    });
  });

  afterAll(async () => {
    // Clean up temp files
    // await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('analyzes and extracts all token references from CSS variables', async () => {
    // Run the analyzer on our test files
    const analysis = await analyzeFile(stylesFilePath, project);

    // Verify the overall structure
    expect(analysis).toHaveProperty('styles');
    expect(analysis).toHaveProperty('metadata');

    const { styles } = analysis;
    expect(styles).toHaveProperty('useStyles');

    console.log(styles);

    const useStyles = styles.useStyles;

    // 1. Verify direct token reference
    expect(useStyles.direct.tokens).toContainEqual(
      expect.objectContaining({
        property: 'color',
        token: 'tokens.colorNeutralForeground1',
      }),
    );

    // 2. Verify CSS variable with token
    expect(useStyles.cssVar.tokens).toContainEqual(
      expect.objectContaining({
        property: 'color',
        token: 'tokens.colorBrandForeground1',
      }),
    );

    // 3. Verify imported direct token
    expect(useStyles.importedToken.tokens).toContainEqual(
      expect.objectContaining({
        property: 'color',
        token: 'tokens.colorBrandForeground1',
        isVariableReference: true,
      }),
    );

    // 4. Verify imported CSS variable with token
    expect(useStyles.importedCssVar.tokens).toContainEqual(
      expect.objectContaining({
        property: 'color',
        token: 'tokens.colorBrandForeground2',
        isVariableReference: true,
      }),
    );

    // 5. Verify nested CSS variable with token
    expect(useStyles.nestedCssVar.tokens).toContainEqual(
      expect.objectContaining({
        property: 'color',
        token: 'tokens.colorBrandForeground3',
      }),
    );

    // 6. Verify imported nested CSS variable with token
    expect(useStyles.importedNestedVar.tokens).toContainEqual(
      expect.objectContaining({
        property: 'color',
        token: 'tokens.colorNeutralForeground3',
        isVariableReference: true,
      }),
    );

    // 7. Verify complex CSS variable with multiple tokens
    const complexVarTokens = useStyles.complexVar.tokens;
    expect(complexVarTokens).toHaveLength(2);
    expect(complexVarTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          token: 'tokens.colorNeutralForeground4',
        }),
        expect.objectContaining({
          token: 'tokens.colorBrandForeground4',
        }),
      ]),
    );

    // 8. Verify imported complex CSS variable with multiple tokens
    const importedComplexVarTokens = useStyles.importedComplexVar.tokens;
    expect(importedComplexVarTokens.length).toBeGreaterThan(1);
    expect(importedComplexVarTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          token: 'tokens.colorBrandBackground',
          isVariableReference: true,
        }),
        expect.objectContaining({
          token: 'tokens.colorNeutralBackground',
          isVariableReference: true,
        }),
      ]),
    );
  });
});

// This test focuses on the full end-to-end integration of the CSS variable extraction
// with the module resolution system
describe('CSS Variable Cross-Module Resolution E2E', () => {
  let project: Project;
  let tempDir: string;

  beforeAll(async () => {
    // Create temp directory and subdirectories for test files
    tempDir = path.join(__dirname, 'temp-cross-module-test');
    const varsDir = path.join(tempDir, 'tokens');
    const stylesDir = path.join(tempDir, 'styles');

    await fs.mkdir(varsDir, { recursive: true });
    await fs.mkdir(stylesDir, { recursive: true });

    // Create a deeper structure to test cross-module resolution
    await fs.writeFile(
      path.join(varsDir, 'colors.ts'),
      `
      // Base token definitions
      export const primaryToken = 'tokens.colorBrandPrimary';
      export const secondaryToken = 'tokens.colorBrandSecondary';
      `,
    );

    await fs.writeFile(
      path.join(varsDir, 'variables.ts'),
      `
      import { primaryToken, secondaryToken } from './colors';

      // CSS Variables referencing tokens
      export const primaryVar = \`var(--primary, \${primaryToken})\`;
      export const nestedVar = \`var(--nested, var(--fallback, \${secondaryToken}))\`;
      export const multiTokenVar = \`var(--multi, \${primaryToken} \${secondaryToken})\`;
      `,
    );

    await fs.writeFile(
      path.join(varsDir, 'index.ts'),
      `
      // Re-export everything
      export * from './colors';
      export * from './variables';
      `,
    );

    await fs.writeFile(
      path.join(stylesDir, 'component.ts'),
      `
      import { makeStyles } from '@griffel/react';
      import { primaryToken, primaryVar, nestedVar, multiTokenVar } from '../variables';

      const useStyles = makeStyles({
        root: {
          // Direct import
          color: primaryToken,
          // CSS var import
          backgroundColor: primaryVar,
          // Nested CSS var import
          borderColor: nestedVar,
          // Complex var with multiple tokens
          padding: multiTokenVar,
        }
      });

      export default useStyles;
      `,
    );

    // Initialize project
    project = new Project({
      tsConfigFilePath: path.join(tempDir, '../../../tsconfig.json'),
      skipAddingFilesFromTsConfig: true,
    });
  });

  afterAll(async () => {
    // Clean up temp files
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('resolves token references across module boundaries with CSS vars', async () => {
    // Run the analyzer on the component styles file
    const componentPath = path.join(tempDir, 'styles', 'component.ts');
    const analysis = await analyzeFile(componentPath, project);

    const { styles } = analysis;
    expect(styles).toHaveProperty('useStyles');

    const useStyles = styles.useStyles;
    const rootStyle = useStyles.root;

    // Verify tokens were extracted from all import types
    expect(rootStyle.tokens).toEqual(
      expect.arrayContaining([
        // Direct import of token
        expect.objectContaining({
          property: 'color',
          token: 'tokens.colorBrandPrimary',
          isVariableReference: true,
        }),
        // Import of CSS var with token
        expect.objectContaining({
          property: 'backgroundColor',
          token: 'tokens.colorBrandPrimary',
          isVariableReference: true,
        }),
        // Import of nested CSS var with token
        expect.objectContaining({
          property: 'borderColor',
          token: 'tokens.colorBrandSecondary',
          isVariableReference: true,
        }),
        // Multiple tokens from a complex var
        expect.objectContaining({
          property: 'padding',
          token: 'tokens.colorBrandPrimary',
          isVariableReference: true,
        }),
        expect.objectContaining({
          property: 'padding',
          token: 'tokens.colorBrandSecondary',
          isVariableReference: true,
        }),
      ]),
    );
  });
});
