import 'reflect-metadata';
import { AgentJobCompleteDto, AgentJobResultDto } from './agent-job.dto';

describe('Agent job DTO runtime metadata', () => {
  it('loads the decorated nested result type without a forward-reference crash', () => {
    expect(new AgentJobCompleteDto()).toBeInstanceOf(AgentJobCompleteDto);
    expect(new AgentJobResultDto()).toBeInstanceOf(AgentJobResultDto);
  });
});
