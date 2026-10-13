import {createFileRoute} from '@tanstack/react-router';
import {BrandPage,brandHead} from '@/components/brand-page';
export const Route=createFileRoute('/kids')({head:()=>brandHead('kids'),component:Page});
function Page(){return <BrandPage pageKey="kids"/>}
