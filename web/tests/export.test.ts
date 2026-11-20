import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {db,getPool,schema} from '@/db';
import {createCourseArchive,exportSlug,exportSourceUrl} from '@/lib/course-export';
import {createSource} from '@/lib/ingest/pipeline';
import {deleteAccount} from '@/lib/courses';
import {FIXTURES,makeUser,makeCourse,prepareDb,waitForDocument} from './helpers';
let owner:string,other:string,course:string,missing:string;
beforeAll(async()=>{
 await prepareDb();owner=(await makeUser('export-owner')).id;other=(await makeUser('export-other')).id;course=(await makeCourse(owner,'Course ../outside')).id;
 await db.insert(schema.providerSettings).values({userId:owner,baseUrl:'https://api.openai.com/v1',model:'test',apiKeyEnc:'PRIVATE_PROVIDER_SENTINEL',keyHint:'test',disclosureAckAt:new Date()});
 const input={userId:owner,courseId:course,moduleId:null,kind:'file' as const,mime:'text/plain',originUrl:'https://example.edu/notes?private_token=DO_NOT_EXPORT#fragment'};
 const a=await createSource({...input,title:'../Unsafe \\ title',filename:'notes.txt',data:Buffer.from('These private synthetic course notes are included in the archive.')});await waitForDocument(a.documentId);
 const p=await createSource({...input,title:'A real PDF fixture',filename:'notes.pdf',data:await fs.readFile(path.join(FIXTURES,'qmb-sample/module1-simple-regression.pdf'))});await waitForDocument(p.documentId);
 const b=await createSource({...input,title:'Missing original',filename:'missing.txt',data:Buffer.from('This missing-original source still has an extracted reference.')});await waitForDocument(b.documentId);missing=b.documentId;
 await db.update(schema.sourceDocuments).set({storagePath:'../outside/secret.txt'}).where(eq(schema.sourceDocuments.id,missing));
},90_000);
afterAll(async()=>{if(missing)await db.update(schema.sourceDocuments).set({storagePath:owner+'/'+missing+'.txt'}).where(eq(schema.sourceDocuments.id,missing));if(owner)await deleteAccount(owner);if(other)await deleteAccount(other);await getPool().end()});
it('normalizes archive paths and removes private URL query strings',()=>{
 expect(exportSlug('../../outside\\file')).toBe('outside-file');expect(exportSourceUrl('https://person:secret@example.edu/a?token=secret#b')).toBe('https://example.edu/a');expect(exportSourceUrl('javascript:alert(1)')).toBeNull();
});
it('streams an owner-only readable ZIP and never includes provider credentials',async()=>{
 expect(await createCourseArchive(other,course)).toBeNull();expect(await createCourseArchive(owner,'bad')).toBeNull();
 const archive=(await createCourseArchive(owner,course))!;const buffers=[];for await(const chunk of archive.stream)buffers.push(Buffer.from(chunk));const data=Buffer.concat(buffers);
 const inspected=JSON.parse(execFileSync('python3',['-c',"import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({'names':z.namelist(),'bad':z.testzip(),'readme':z.read('START_HERE.md').decode(),'manifest':json.loads(z.read('materials/manifest.json')),'all': '\\n'.join(z.read(n).decode(errors='ignore') for n in z.namelist() if n.endswith(('.md','.json','.txt')))}))"],{input:data,maxBuffer:8*1024*1024}).toString());
 expect(inspected.bad).toBeNull();expect(inspected.names).toContain('STUDY_PROMPT.txt');expect(inspected.names.some((n:string)=>n.endsWith('.pdf'))).toBe(true);
 expect(inspected.names.every((n:string)=>!n.startsWith('/')&&!n.includes('..')&&!n.includes('\\'))).toBe(true);
 expect(inspected.all).toContain('These private synthetic course notes');expect(inspected.all).not.toContain('PRIVATE_PROVIDER_SENTINEL');expect(inspected.all).not.toContain('DO_NOT_EXPORT');
 expect(inspected.manifest).toHaveLength(3);expect(inspected.manifest.find((m:{id:string})=>m.id===missing).originalAvailable).toBe(false);expect(inspected.readme).toContain('UNAVAILABLE');
});
