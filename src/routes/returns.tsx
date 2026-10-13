import {createFileRoute} from '@tanstack/react-router';
import {BrandPage,brandHead} from '@/components/brand-page';
export const Route=createFileRoute('/returns')({head:()=>brandHead('returns'),component:Page});
function Page(){return <BrandPage pageKey="returns"/>}
