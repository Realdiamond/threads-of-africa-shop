import {createFileRoute} from '@tanstack/react-router';
import {BrandPage,brandHead} from '@/components/brand-page';
export const Route=createFileRoute('/contact')({head:()=>brandHead('contact'),component:Page});
function Page(){return <BrandPage pageKey="contact"/>}
