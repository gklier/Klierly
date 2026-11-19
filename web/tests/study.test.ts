import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {db,schema,getPool} from '@/db';
import {buildStudyState,addReviewTurn,angleCoverage,topicsNeedingReview} from '@/lib/study/core';
import {startStudy,studyView,moveStudy} from '@/lib/study/service';
import {makeCourse,makeUser,prepareDb} from './helpers';
import {deleteAccount} from '@/lib/courses';

describe('multi-angle study scheduling',()=>{
 const topics=[{id:'a',questionIds:['q1','q2']},{id:'b',questionIds:[]},{id:'c',questionIds:['q3']}];
 it('interleaves concepts and includes applications only when there is a question',()=>{
  const s=buildStudyState(topics,'mix',()=>.5);expect(s.queue.slice(0,3).map(t=>t.angle)).toEqual(['recall','recall','recall']);
  expect(s.queue.filter(t=>t.angle==='apply')).toHaveLength(2);expect(s.queue.every(t=>t.angle!=='apply'||t.questionId)).toBe(true);
  expect(new Set(s.queue.map(t=>t.key)).size).toBe(s.queue.length);
 });
 it('returns a miss with a different angle and bounds retries',()=>{
  const s=buildStudyState(topics,'mix',()=>.5);const t=s.queue[0];const queue=addReviewTurn(s,t,topics.find(p=>p.id===t.topicId)!);
  expect(queue).toHaveLength(s.queue.length+1);expect(queue.at(-1)!.angle).not.toBe(t.angle);
  const repeat=queue.at(-1)!;expect(addReviewTurn({...s,queue},repeat,topics[0])).toBe(queue);
  expect(addReviewTurn({...s,position:s.queue.length-1},t,topics[0])).toBe(s.queue);
 });
 it('shows the latest outcome for each angle and clears a recovered miss',()=>{
  const outcomes=[{key:'1',topicId:'a',angle:'recall' as const,correct:false,selfRated:true},{key:'2',topicId:'a',angle:'recall' as const,correct:true,selfRated:true}];
  expect(topicsNeedingReview(outcomes).size).toBe(0);expect(angleCoverage(outcomes).get('a')?.has('recall')).toBe(true);
  outcomes.push({...outcomes[0],key:'3'});expect(topicsNeedingReview(outcomes).has('a')).toBe(true);expect(angleCoverage(outcomes).get('a')?.has('recall')).toBe(false);
 });
});
let owner:string,other:string,course:string,topicIds:string[];
beforeAll(async()=>{
 await prepareDb();owner=(await makeUser('study-owner')).id;other=(await makeUser('study-other')).id;course=(await makeCourse(owner)).id;
 topicIds=[];
 for(const [name,summary] of [['Moving averages','Average a fixed window of past observations to forecast the next period.'],['Paired comparisons','Use within-pair differences when observations are linked in before and after pairs.'],['One-way analysis','Compare population means across levels of one factor using between and within variation.']]){
  const [t]=await db.insert(schema.topics).values({userId:owner,courseId:course,name}).returning();topicIds.push(t.id);
  await db.insert(schema.learnNotes).values({userId:owner,courseId:course,topicId:t.id,origin:'sample',body:{summary,keyPoints:[]}});
  await db.insert(schema.questions).values({userId:owner,courseId:course,topicId:t.id,type:'numeric',stem:'Compute 2 + 3.',numericValue:'5',tolerance:'0',explanation:'Two plus three equals five.',correctnessConfidence:'verified-numeric',explanationConfidence:'author-reviewed',origin:'sample',fingerprint:t.id});
 }
});
afterAll(async()=>{if(owner)await deleteAccount(owner);if(other)await deleteAccount(other);await getPool().end()});
it('keeps study rounds private, rejects premature self-grading and survives duplicate saves',async()=>{
 const started=await startStudy(owner,course,'mix',3,[],[]);expect(started.id).toBeTruthy();const id=started.id!;
 expect(await studyView(other,id)).toBeNull();expect((await moveStudy(other,id,'fake',{kind:'reveal'})).ok).toBe(false);
 const view=(await studyView(owner,id))!;const key=view.card!.key;expect(view.card!.answer).toBeUndefined();
 expect((await moveStudy(owner,id,key,{kind:'answer',rating:'remembered'})).ok).toBe(false);
 await moveStudy(owner,id,key,{kind:'reveal'});expect((await studyView(owner,id))!.card!.answer).toBeTruthy();
 await Promise.all([moveStudy(owner,id,key,{kind:'answer',rating:'remembered'}),moveStudy(owner,id,key,{kind:'answer',rating:'remembered'})]);
 expect((await studyView(owner,id))!.completed).toBe(1);
 await moveStudy(owner,id,key,{kind:'next'});expect((await moveStudy(owner,id,key,{kind:'next'})).ok).toBe(false);expect((await studyView(owner,id))!.position).toBe(1);
});
it('grades application on the server and keeps self-rated recall separate',async()=>{
 const started=await startStudy(owner,course,'mix',1,[topicIds[0]],[]);const id=started.id!;
 for(let n=0;n<3;n++){
  const view=(await studyView(owner,id))!;const c=view.card!;
  if(c.selfRated){await moveStudy(owner,id,c.key,{kind:'reveal'});await moveStudy(owner,id,c.key,{kind:'answer',rating:'remembered'});}
  else {expect((await moveStudy(owner,id,c.key,{kind:'reveal'})).ok).toBe(false);await moveStudy(owner,id,c.key,{kind:'answer',choice:0});}
  await moveStudy(owner,id,c.key,{kind:'next'});
 }
 const app=(await studyView(owner,id))!;expect(app.card!.angle).toBe('apply');expect(app.card!.answer).toBeUndefined();
 expect((await moveStudy(owner,id,app.card!.key,{kind:'reveal'})).ok).toBe(false);
 await moveStudy(owner,id,app.card!.key,{kind:'answer',value:'5'});const saved=(await studyView(owner,id))!;
 expect(saved.card!.outcome).toEqual({key:app.card!.key,topicId:app.card!.topicId,angle:'apply',correct:true,selfRated:false});
 expect(saved.selfTotal).toBe(3);expect(saved.objectiveTotal).toBe(1);expect(saved.card!.answer).toBe('5');
});
