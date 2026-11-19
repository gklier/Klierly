import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{return {name:'Klierly',short_name:'Klierly',description:'Your course material. A clearer way to study.',start_url:'/',scope:'/',display:'standalone',background_color:'#f3f5f7',theme_color:'#2346c0',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]};}
