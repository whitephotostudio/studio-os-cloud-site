import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startCollageFixture,fixtureId } from './fixtures/collage-e2e/server.mjs';
import { runCollageScenario,runEventCollageScenario,fixtureClient,publishFixtureProduct } from './fixtures/collage-e2e/scenario.mjs';

test('isolated HTTP publish, parent checkout, signed simulated payment and immutable production', {timeout:180000}, async t => {
  const fixture=await startCollageFixture();
  t.after(()=>fixture.close());
  const result=await runCollageScenario(fixture.config,{publish:true});
  console.log('Isolated collage evidence:', fixture.directory, result.nativeConfig);
});
test('collage product IDs cannot bypass school, sibling or event price sheets', {timeout:180000}, async t=>{
  const fixture=await startCollageFixture({includeEvent:true});t.after(()=>fixture.close());
  const config=fixture.config,client=fixtureClient(config),published=await publishFixtureProduct(config,client,{mixed:true});
  const foreignProfile=fixtureId(90),foreignProduct=fixtureId(91);
  await fixture.database.query('insert into package_profiles(id,photographer_id,name) values($1,$2,$3)',[foreignProfile,config.ids.owner,'Other owned price sheet']);
  await fixture.database.query("insert into packages(id,photographer_id,profile_id,name,category,price_cents,items) values($1,$2,$3,'Cheaper other-sheet collage','print',1,$4)",[foreignProduct,config.ids.owner,foreignProfile,JSON.stringify(published.product.items)]);
  const lanes=[];for(const parent of [...config.parents,config.event.credentials])lanes.push((await client.ok('/api/portal/session',{body:{kind:parent.kind,galleryId:parent.galleryId,pin:parent.pin,email:parent.email}})).json);
  const entry=(packageId,index=0,event=false)=>{
    const media=event?config.event.media:config.media.filter(row=>row.schoolId===config.parents[index].galleryId);
    const selection={version:1,templateVersionId:published.version.id,placements:published.version.design.slots.map((slot,index)=>({slotId:slot.id,mediaId:event?media[index%3].id:media[index%3].key,zoom:1,x:.5,y:.5})),caption:{studentName:'Fixture',schoolName:'School',year:'2026'}};
    return {packageId,quantity:1,slots:[{assignedImageUrl:media[0].key},{collage:selection},{collage:structuredClone(selection)}]};
  };
  const common={parent:{name:'Fixture Parent',email:'parent@example.test'},delivery:{method:'pickup'}};
  const reject=async(route,body)=>{const response=await client.request(route,{body,headers:{'x-studio-parent-session':'1','Idempotency-Key':randomUUID()}});assert.equal(response.status,409,JSON.stringify(response.json));assert.match(response.json.message,/current price sheet/);assert.equal((await fixture.database.query('select count(*)::int count from orders')).rows[0].count,0);};
  await reject('/api/portal/orders/create',{...common,parentLaneId:lanes[0].laneId,entries:[entry(foreignProduct)]});
  await reject('/api/portal/orders/create-combined',{...common,groups:[{parentLaneId:lanes[0].laneId,entries:[entry(published.product.id)]},{parentLaneId:lanes[1].laneId,entries:[entry(foreignProduct,1)]}]});
  await reject('/api/portal/orders/create',{...common,mode:'event',parentLaneId:lanes[2].laneId,entries:[entry(foreignProduct,0,true)]});
  // Gallery settings and photographer defaults use the same precedence as the
  // actual parent context, even when the explicit gallery sheet is absent.
  await fixture.database.query('update schools set package_profile_id=null,gallery_settings=$1 where id=$2',[JSON.stringify({extras:{priceSheetProfileId:config.profileId}}),config.ids.school]);
  await reject('/api/portal/orders/create',{...common,parentLaneId:lanes[0].laneId,entries:[entry(foreignProduct)]});
  await fixture.database.query("update schools set gallery_settings='{}' where id=$1",[config.ids.school]);
  await reject('/api/portal/orders/create',{...common,parentLaneId:lanes[0].laneId,entries:[entry(foreignProduct)]});
});
test('event gallery HTTP checkout enforces album PIN scope and produces both paid collage copies', {timeout:180000}, async t=>{
  const fixture=await startCollageFixture({includeEvent:true});t.after(()=>fixture.close());
  await runEventCollageScenario(fixture.config);
  console.log('Isolated event collage evidence:',fixture.directory);
});
