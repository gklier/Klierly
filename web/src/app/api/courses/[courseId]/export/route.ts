import {Readable} from 'node:stream';
import {getUser} from '@/lib/auth';
import {createCourseArchive} from '@/lib/course-export';
import {rateLimit} from '@/lib/ratelimit';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=300;
const g=globalThis as unknown as {__klierlyExports?:Set<string>};
const active=g.__klierlyExports??=new Set<string>();
const error=(message:string,status:number)=>Response.json({error:{message}},{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:Request,{params}:{params:Promise<{courseId:string}>}){
 const user=await getUser();if(!user)return error('Sign in to download your course.',401);
 if(active.has(user.id))return error('A course download is already running. Finish or cancel it before starting another.',429);
 if(!rateLimit('course-export:'+user.id,5,15*60_000).ok)return error('Several downloads were started recently. Try again in a few minutes.',429);
 active.add(user.id);let released=false;const release=()=>{if(!released){released=true;active.delete(user.id)}};
 try{
  const archive=await createCourseArchive(user.id,(await params).courseId,req.signal);
  if(!archive){release();return error('That course was not found.',404)}
  archive.stream.once('end',release);archive.stream.once('close',release);archive.stream.once('error',release);
  return new Response(Readable.toWeb(archive.stream) as ReadableStream<Uint8Array>,{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${archive.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Klierly-Sources':String(archive.sourceCount)}});
 }catch{release();return error('Could not prepare the course archive. Please try again.',500)}
}
