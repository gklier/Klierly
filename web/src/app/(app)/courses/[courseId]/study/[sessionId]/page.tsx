import {notFound} from 'next/navigation';
import {requireUser} from '@/lib/auth';
import {getCourse} from '@/lib/courses';
import {studyView} from '@/lib/study/service';
import {StudyRunner} from '@/components/study-runner';
export const metadata={title:'Study round'};
export default async function StudyRoundPage({params}:{params:Promise<{courseId:string;sessionId:string}>}){
 const user=await requireUser();const {courseId,sessionId}=await params;const course=await getCourse(user.id,courseId);const view=await studyView(user.id,sessionId);
 if(!view||view.courseId!==course.id)notFound();
 return <StudyRunner initial={view} courseName={course.name}/>;
}
