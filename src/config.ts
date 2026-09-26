import * as fs from 'fs/promises';
import * as path from 'path';
import { PreviewConfig } from './preview/previewConfig';

export interface CufolioConfig {
  scanPath: string;
  port: number;
  debounceMs: number;
  customIgnorePatterns: string[];
  /** Preview / capture tunables; see src/preview/previewConfig.ts for defaults. */
  preview?: Partial<PreviewConfig>;
}

const DEFAULT_CONFIG: CufolioConfig = {
  scanPath: process.env.CUFOLIO_SCAN_PATH || '/Users/alex/Documents/Cufolio',
  port: parseInt(process.env.PORT || '3030'),
  debounceMs: 2000,
  customIgnorePatterns: [
    'cufolio-navigator-server/**' // Exclude the server itself from scanning
  ]
};

export class ConfigManager {
  private config: CufolioConfig;
  private configPath: string;

  constructor(configPath: string = './cufolio.config.json') {
    this.configPath = configPath;
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Load configuration from file, or create default if not exists
   */
  async load(): Promise<CufolioConfig> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const fileConfig = JSON.parse(content);
      this.config = { ...DEFAULT_CONFIG, ...fileConfig };
    } catch (error) {
      // Config file doesn't exist, create it with defaults
      console.log('📝 Creating default configuration file...');
      await this.save();
    }

    return this.config;
  }

  /**
   * Save current configuration to file
   */
  async save(): Promise<void> {
    const content = JSON.stringify(this.config, null, 2);
    await fs.writeFile(this.configPath, content, 'utf-8');
  }

  /**
   * Get current configuration
   */
  get(): CufolioConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  update(updates: Partial<CufolioConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
