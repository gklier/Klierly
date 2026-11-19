import {Icon} from './icons';
/** Native browser download keeps large archives out of the page's JavaScript memory. */
export function CourseDownload({courseId}:{courseId:string}){
 return <a href={`/api/courses/${courseId}/export`} download className="btn min-h-12"><Icon name="file"/>Download course ZIP</a>;
}
