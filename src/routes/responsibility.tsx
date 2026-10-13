import {createFileRoute} from '@tanstack/react-router';
import {BrandPage,brandHead} from '@/components/brand-page';
export const Route=createFileRoute('/responsibility')({head:()=>brandHead('responsibility'),component:Page});
function Page(){return <BrandPage pageKey="responsibility"/>}
