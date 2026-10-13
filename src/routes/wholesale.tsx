import {createFileRoute} from '@tanstack/react-router';
import {BrandPage,brandHead} from '@/components/brand-page';
export const Route=createFileRoute('/wholesale')({head:()=>brandHead('wholesale'),component:Page});
function Page(){return <BrandPage pageKey="wholesale"/>}
