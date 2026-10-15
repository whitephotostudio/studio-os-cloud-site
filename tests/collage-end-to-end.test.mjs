import test from 'node:test';
import { startCollageFixture } from './fixtures/collage-e2e/server.mjs';
import { runCollageScenario,runEventCollageScenario } from './fixtures/collage-e2e/scenario.mjs';

test('isolated HTTP publish, parent checkout, signed simulated payment and immutable production', {timeout:180000}, async t => {
  const fixture=await startCollageFixture();
  t.after(()=>fixture.close());
  const result=await runCollageScenario(fixture.config,{publish:true});
  console.log('Isolated collage evidence:', fixture.directory, result.nativeConfig);
});
test('event gallery HTTP checkout enforces album PIN scope and produces both paid collage copies', {timeout:180000}, async t=>{
  const fixture=await startCollageFixture({includeEvent:true});t.after(()=>fixture.close());
  await runEventCollageScenario(fixture.config);
  console.log('Isolated event collage evidence:',fixture.directory);
});
