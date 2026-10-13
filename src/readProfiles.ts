import * as path from 'path';
import { ProfileService } from './profiles';
import { ConfigManager } from './config';
import { EnrichedProjectMetadata } from './enrichedMetadata';
import { MetadataDetector } from './metadataDetector';
import { MetadataEnricher } from './enrichedMetadata';
import { projectIdFor } from './preview/identity';

async function main() {
  const config = new ConfigManager();
  await config.load();
  const response = await fetch(`http://localhost:${config.get().port}/api/projects`);
  if (!response.ok) throw new Error('The running catalog could not be read.');
  const catalog = await response.json() as EnrichedProjectMetadata[];
  const selected = new Set(process.argv.slice(2));
  const projects = selected.size ? catalog.filter(p => selected.has(p.name) || selected.has(p.id || '')) : catalog;
  for (const projectPath of selected) {
    if (!path.isAbsolute(projectPath) || projects.some(p => p.path === projectPath)) continue;
    const metadata = await new MetadataDetector().detectMetadata(projectPath);
    const project = await new MetadataEnricher().enrichMetadata(metadata);
    project.id = projectIdFor(projectPath, config.get().scanPath);
    projects.push(project);
  }
  if (!projects.length) throw new Error('No matching projects in the current catalog.');
  let service: ProfileService;
  let finish: () => void;
  const completed = new Promise<void>(resolve => { finish = resolve; });
  service = new ProfileService(path.resolve(__dirname, '..', 'data', 'meaning'), () => {
    const status = service.status();
    console.log(status.active ? `Reading ${status.active}` : status.error || 'Source profile saved');
    if ((!status.active && !status.queued) || status.error) finish();
  });
  await service.init();
  service.setProjects(projects);
  if (!service.status().enabled) await service.setEnabled(true);
  await completed;
  if (service.status().error) throw new Error(service.status().error!);
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
