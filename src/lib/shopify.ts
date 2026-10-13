import {toast} from 'sonner';
import {queryOptions} from '@tanstack/react-query';

export const SHOPIFY_API_VERSION = '2025-07';
export const SHOPIFY_STORE_PERMANENT_DOMAIN = 'threads-of-africa-shop-iz6bd-w4db6jp1.myshopify.com';
export const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
export const SHOPIFY_STOREFRONT_TOKEN = '6a1cc44a679a49958c4539b126d7fa00';

export interface ShopifyOption{name:string;values:string[]}
export interface ShopifyVariantNode{
  id:string;title:string;availableForSale:boolean;
  price:{amount:string;currencyCode:string};
  selectedOptions:Array<{name:string;value:string}>;
}
export interface ShopifyProduct{
  node:{
    id:string;title:string;description:string;handle:string;productType:string;tags:string[];
    priceRange:{minVariantPrice:{amount:string;currencyCode:string}};
    images:{edges:Array<{node:{url:string;altText:string|null}}>} | null;
    variants:{edges:Array<{node:ShopifyVariantNode}>};
    options:ShopifyOption[];
  };
}

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id title description handle productType tags
          priceRange { minVariantPrice { amount currencyCode } }
          images(first: 5) { edges { node { url altText } } }
          variants(first: 20) {
            edges { node { id title availableForSale price { amount currencyCode } selectedOptions { name value } } }
          }
          options { name values }
        }
      }
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = `
  query GetProduct($handle: String!) {
    product(handle: $handle) {
      id title description handle productType tags
      priceRange { minVariantPrice { amount currencyCode } }
      images(first: 5) { edges { node { url altText } } }
      variants(first: 20) {
        edges { node { id title availableForSale price { amount currencyCode } selectedOptions { name value } } }
      }
      options { name values }
    }
  }
`;

export async function storefrontApiRequest(query:string, variables:Record<string,unknown> = {}) {
  const response = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({query, variables}),
  });
  if (response.status === 402) {
    toast.error('Shopify: Payment required', {
      description: 'Shopify API access requires an active Shopify billing plan. Visit https://admin.shopify.com to upgrade.',
    });
    return undefined;
  }
  if (!response.ok) throw new Error(`Shopify HTTP error ${response.status}`);
  const data = await response.json();
  if (data.errors) throw new Error(`Shopify: ${data.errors.map((e:{message:string}) => e.message).join(', ')}`);
  return data as Record<string, any>;
}

export const productsQueryOptions = queryOptions({
  queryKey: ['shopify-products'],
  queryFn: async (): Promise<ShopifyProduct[]> => {
    const data = await storefrontApiRequest(PRODUCTS_QUERY, {first: 50});
    return (data?.data?.products?.edges ?? []) as ShopifyProduct[];
  },
  staleTime: 60_000,
});

export const productQueryOptions = (handle:string) => queryOptions({
  queryKey: ['shopify-product', handle],
  queryFn: async (): Promise<ShopifyProduct['node'] | null> => {
    const data = await storefrontApiRequest(PRODUCT_BY_HANDLE_QUERY, {handle});
    return (data?.data?.product ?? null) as ShopifyProduct['node'] | null;
  },
  staleTime: 60_000,
});

// ---------- Cart mutations (Storefront API, 2025-07) ----------

const CART_QUERY = `
  query cart($id: ID!) {
    cart(id: $id) { id totalQuantity }
  }
`;

const CART_CREATE_MUTATION = `
  mutation cartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id checkoutUrl
        lines(first: 100) { edges { node { id merchandise { ... on ProductVariant { id } } } } }
      }
      userErrors { field message }
    }
  }
`;

const CART_LINES_ADD_MUTATION = `
  mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart { id lines(first: 100) { edges { node { id merchandise { ... on ProductVariant { id } } } } } }
      userErrors { field message }
    }
  }
`;

const CART_LINES_UPDATE_MUTATION = `
  mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart { id }
      userErrors { field message }
    }
  }
`;

const CART_LINES_REMOVE_MUTATION = `
  mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { id }
      userErrors { field message }
    }
  }
`;

type UserErrors = Array<{field:(string|null)[]|null;message:string}>;

function formatCheckoutUrl(checkoutUrl:string):string {
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set('channel', 'online_store');
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

function isCartNotFoundError(userErrors:UserErrors):boolean {
  return userErrors.some(e => e.message.toLowerCase().includes('cart not found') || e.message.toLowerCase().includes('does not exist'));
}

export async function createShopifyCart(item:{variantId:string;quantity:number}):Promise<{cartId:string;checkoutUrl:string;lineId:string}|null> {
  const data = await storefrontApiRequest(CART_CREATE_MUTATION, {
    input: {lines: [{quantity: item.quantity, merchandiseId: item.variantId}]},
  });
  const userErrors:UserErrors = data?.data?.cartCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    console.error('Cart creation failed:', userErrors);
    return null;
  }
  const cart = data?.data?.cartCreate?.cart;
  if (!cart?.checkoutUrl) return null;
  const lineId = cart.lines?.edges?.[0]?.node?.id;
  if (!lineId) return null;
  return {cartId: cart.id, checkoutUrl: formatCheckoutUrl(cart.checkoutUrl), lineId};
}

export async function addLineToShopifyCart(cartId:string, item:{variantId:string;quantity:number}):Promise<{success:boolean;lineId?:string;cartNotFound?:boolean}> {
  const data = await storefrontApiRequest(CART_LINES_ADD_MUTATION, {
    cartId,
    lines: [{quantity: item.quantity, merchandiseId: item.variantId}],
  });
  const userErrors:UserErrors = data?.data?.cartLinesAdd?.userErrors ?? [];
  if (isCartNotFoundError(userErrors)) return {success: false, cartNotFound: true};
  if (userErrors.length > 0) {
    console.error('Add line failed:', userErrors);
    return {success: false};
  }
  const lines = data?.data?.cartLinesAdd?.cart?.lines?.edges ?? [];
  const newLine = lines.find((l:{node:{id:string;merchandise:{id:string}}}) => l.node.merchandise.id === item.variantId);
  return {success: true, lineId: newLine?.node?.id};
}

export async function updateShopifyCartLine(cartId:string, lineId:string, quantity:number):Promise<{success:boolean;cartNotFound?:boolean}> {
  const data = await storefrontApiRequest(CART_LINES_UPDATE_MUTATION, {
    cartId,
    lines: [{id: lineId, quantity}],
  });
  const userErrors:UserErrors = data?.data?.cartLinesUpdate?.userErrors ?? [];
  if (isCartNotFoundError(userErrors)) return {success: false, cartNotFound: true};
  if (userErrors.length > 0) {
    console.error('Update line failed:', userErrors);
    return {success: false};
  }
  return {success: true};
}

export async function removeLineFromShopifyCart(cartId:string, lineId:string):Promise<{success:boolean;cartNotFound?:boolean}> {
  const data = await storefrontApiRequest(CART_LINES_REMOVE_MUTATION, {
    cartId,
    lineIds: [lineId],
  });
  const userErrors:UserErrors = data?.data?.cartLinesRemove?.userErrors ?? [];
  if (isCartNotFoundError(userErrors)) return {success: false, cartNotFound: true};
  if (userErrors.length > 0) {
    console.error('Remove line failed:', userErrors);
    return {success: false};
  }
  return {success: true};
}

export async function verifyCart(cartId:string):Promise<boolean> {
  const data = await storefrontApiRequest(CART_QUERY, {id: cartId});
  const cart = data?.data?.cart;
  return Boolean(cart && cart.totalQuantity > 0);
}

export const money = (amount:string, currencyCode:string) =>
  new Intl.NumberFormat('en-US',{style:'currency',currency:currencyCode || 'USD'}).format(parseFloat(amount));
