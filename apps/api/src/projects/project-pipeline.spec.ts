import type { Environment, TemplateManifest } from '../domain/types';
import { pipelineStages, withDeploymentState } from './project-pipeline';

const runtime = { artifact: 'runtime' } as TemplateManifest;
const statics = { artifact: 'static' } as TemplateManifest;
const status = (context: string, state: string) => ({
  context,
  status: state,
  targetUrl: `https://scm/${context}`,
});

describe('pipeline stages of the single-job workflow (ADR-139)', () => {
  it('shows one build stage for current workflows and before any status exists', () => {
    expect(pipelineStages(runtime, [status('ci / build (push)', 'success')])).toEqual([
      { name: 'build', status: 'success', url: 'https://scm/ci / build (push)' },
    ]);
    expect(pipelineStages(statics, null)).toEqual([
      { name: 'build', status: 'pending', url: null },
    ]);
  });

  it('keeps the four stages of projects generated with the older workflow', () => {
    const legacy = [
      status('ci / deploy (push)', 'pending'),
      status('ci / docker build (push)', 'pending'),
      status('ci / test (push)', 'success'),
      status('ci / build (push)', 'success'),
    ];
    expect(pipelineStages(runtime, legacy).map((stage) => stage.name)).toEqual([
      'build',
      'test',
      'docker build',
      'deploy',
    ]);
    expect(pipelineStages(statics, legacy).map((stage) => stage.name)).toEqual([
      'build',
      'test',
      'deploy',
    ]);
  });

  it('adds publication after the build job and holds it until the build succeeded', () => {
    const deploying = { status: 'deploying', deploymentRequired: true } as Environment;
    const running = withDeploymentState(
      pipelineStages(runtime, [status('ci / build (push)', 'success')]),
      deploying,
    );
    expect(running.map((stage) => [stage.name, stage.status])).toEqual([
      ['build', 'success'],
      ['publish', 'running'],
    ]);

    // The build job reports to InitPad from its last step, so it can still
    // be running while publication starts.
    const stillRunning = withDeploymentState(
      pipelineStages(runtime, [status('ci / build (push)', 'pending')]),
      deploying,
    );
    expect(stillRunning.at(-1)).toEqual({
      name: 'publish',
      status: 'pending',
      url: null,
      source: 'platform',
    });
  });
});
