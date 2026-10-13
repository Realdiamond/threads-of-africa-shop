import {createFileRoute} from '@tanstack/react-router';
import {BrandPage,brandHead} from '@/components/brand-page';
export const Route=createFileRoute('/craft')({head:()=>brandHead('craft'),component:Page});
function Page(){return <BrandPage pageKey="craft"/>}
