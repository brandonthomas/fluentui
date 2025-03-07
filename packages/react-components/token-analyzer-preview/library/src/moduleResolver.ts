import * as ts from 'typescript';
import * as path from 'path';
import { Project, SourceFile } from 'ts-morph';
import { log } from './debugUtils.js';

// Create a wrapper around TypeScript APIs for easier mocking
export const tsUtils = {
  resolveModuleName: (
    moduleName: string,
    containingFile: string,
    compilerOptions: ts.CompilerOptions,
    host: ts.ModuleResolutionHost,
  ) => ts.resolveModuleName(moduleName, containingFile, compilerOptions, host),

  getFileSize: (filePath: string) => ts.sys.getFileSize?.(filePath),
};

// Cache for resolved module paths
const modulePathCache = new Map<string, string | null>();

// Cache for resolved source files
const resolvedFilesCache = new Map<string, SourceFile>();

/**
 * Creates a cache key for module resolution
 */
function createCacheKey(moduleSpecifier: string, containingFile: string): string {
  return `${containingFile}:${moduleSpecifier}`;
}

/**
 * Resolves a module specifier to an absolute file path using TypeScript's resolution
 *
 * @param project TypeScript project
 * @param moduleSpecifier The module to resolve (e.g., './utils', 'react')
 * @param containingFile The file containing the import
 * @returns The absolute file path or null if it can't be resolved
 */
export function resolveModulePath(project: Project, moduleSpecifier: string, containingFile: string): string | null {
  const cacheKey = createCacheKey(moduleSpecifier, containingFile);

  // Check cache first
  if (modulePathCache.has(cacheKey)) {
    return modulePathCache.get(cacheKey)!;
  }

  // For relative paths, try a simple path resolution first
  if (moduleSpecifier.startsWith('.')) {
    try {
      const basePath = path.dirname(containingFile);
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];

      // Check if the module specifier already has a valid extension
      const hasExtension = extensions.some(ext => moduleSpecifier.endsWith(ext));

      // 1. If it has an extension, try the exact path first
      if (hasExtension) {
        const exactPath = path.resolve(basePath, moduleSpecifier);
        try {
          const stats = tsUtils.getFileSize(exactPath);
          if (stats !== undefined) {
            modulePathCache.set(cacheKey, exactPath);
            return exactPath;
          }
        } catch (e) {
          // If exact path fails, continue to extension-adding logic
        }
      }

      // 2. Try with added extensions (for paths without extension or if exact path failed)
      if (!hasExtension) {
        for (const ext of extensions) {
          const candidatePath = path.resolve(basePath, moduleSpecifier + ext);
          try {
            // Check if file exists
            const stats = tsUtils.getFileSize(candidatePath);
            if (stats !== undefined) {
              modulePathCache.set(cacheKey, candidatePath);
              return candidatePath;
            }
          } catch (e) {
            // Continue to next extension
          }
        }
      }

      // 3. Try as directory with index file
      const dirPath = hasExtension
        ? path.resolve(
            basePath,
            path.dirname(moduleSpecifier),
            path.basename(moduleSpecifier, path.extname(moduleSpecifier)),
          )
        : path.resolve(basePath, moduleSpecifier);

      for (const ext of extensions) {
        const candidatePath = path.resolve(dirPath, 'index' + ext);
        try {
          const stats = tsUtils.getFileSize(candidatePath);
          if (stats !== undefined) {
            modulePathCache.set(cacheKey, candidatePath);
            return candidatePath;
          }
        } catch (e) {
          // Continue to next extension
        }
      }
    } catch (e) {
      // Fall through to TypeScript's module resolution
    }
  }

  // Use TypeScript's module resolution API
  const result = tsUtils.resolveModuleName(
    moduleSpecifier,
    containingFile,
    project.getCompilerOptions() as ts.CompilerOptions,
    ts.sys,
  );

  // Cache and return the result
  if (result.resolvedModule) {
    const resolvedPath = result.resolvedModule.resolvedFileName;
    modulePathCache.set(cacheKey, resolvedPath);
    return resolvedPath;
  }

  // Cache negative result
  modulePathCache.set(cacheKey, null);
  return null;
}

/**
 * Gets a source file for a module specifier, resolving and adding it if needed
 *
 * @param project TypeScript project
 * @param moduleSpecifier The module to resolve (e.g., './utils', 'react')
 * @param containingFile The file containing the import
 * @returns The resolved source file or null if it can't be resolved
 */
export function getModuleSourceFile(
  project: Project,
  moduleSpecifier: string,
  containingFile: string,
): SourceFile | null {
  log(`Resolving module: ${moduleSpecifier} from ${containingFile}`);

  // Step 1: Try to resolve the module to a file path
  const resolvedPath = resolveModulePath(project, moduleSpecifier, containingFile);
  if (!resolvedPath) {
    log(`Could not resolve module: ${moduleSpecifier}`);
    return null;
  }

  // Step 2: Check if we already have this file
  if (resolvedFilesCache.has(resolvedPath)) {
    return resolvedFilesCache.get(resolvedPath)!;
  }

  // Step 3: Get or add the file to the project
  try {
    // First try to get file if it's already in the project
    let sourceFile = project.getSourceFile(resolvedPath);

    // If not found, add it
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(resolvedPath);
      log(`Added source file: ${resolvedPath}`);
    }

    // Cache the result
    resolvedFilesCache.set(resolvedPath, sourceFile);
    return sourceFile;
  } catch (error) {
    log(`Error adding source file: ${resolvedPath}`, error);
    return null;
  }
}

/**
 * Clears the module resolution caches
 * Useful for testing or when analyzing multiple projects
 */
export function clearModuleCache(): void {
  modulePathCache.clear();
  resolvedFilesCache.clear();
}
