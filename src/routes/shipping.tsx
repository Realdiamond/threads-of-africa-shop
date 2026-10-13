import {createFileRoute} from '@tanstack/react-router';
import {BrandPage,brandHead} from '@/components/brand-page';
export const Route=createFileRoute('/shipping')({head:()=>brandHead('shipping'),component:Page});
function Page(){return <BrandPage pageKey="shipping"/>}
