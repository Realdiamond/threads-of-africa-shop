import amara from '@/assets/amara.jpg';
import kofi from '@/assets/kofi.jpg';
import zuri from '@/assets/zuri.jpg';
import nala from '@/assets/nala.jpg';
export const products = [
 {id:'amara-dress',name:'Amara Ankara Maxi Dress',category:'Women',price:129,image:amara,color:'Sunflower',tag:'Bestseller',description:'A statement in every step. A sweeping maxi silhouette meets a sunlit geometric print, with a fitted bodice and beautifully flowing skirt.'},
 {id:'kofi-shirt',name:'Kofi Heritage Shirt',category:'Men',price:85,image:kofi,color:'Forest',tag:'New arrival',description:'A fresh take on a timeless silhouette. Deep forest green, considered tailoring, and geometric trim come together in an effortlessly versatile shirt.'},
 {id:'zuri-set',name:'Zuri Two-Piece Set',category:'Women',price:145,image:zuri,color:'Terracotta',tag:'',description:'Two pieces. Endless possibilities. An expressive rust-and-ivory print, a flattering cropped top, and flowing wide-leg trousers made to move with you.'},
 {id:'nala-dress',name:'Nala Statement Dress',category:'Women',price:115,image:nala,color:'Ember',tag:'Limited edit',description:'Bold volume and an unforgettable print. Sculptural sleeves frame a vibrant silhouette, bringing a little celebration to the everyday.'},
];
export type Product = typeof products[number];
export const money = (value:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
