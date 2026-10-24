import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as access from './access';
import * as presentation from './presentation';
import * as requests from './request-presentation';
import * as submission from './product-request-submission';
import * as validation from './action-validation';
import * as types from './types';
import * as productEdit from './product-edit';
import * as saveErrors from './save-errors';
import * as movementForm from './movement-form';
import * as movementHistory from './movement-history';
import * as categoryForm from './category-form';
import {previewBrands,previewCategories,previewOverview,previewProduct,previewPickerProducts,previewMovementHistory,previewCategoryOverview} from './preview-data';
import {previewProductRequests} from './request-preview-data';

type Component = React.ComponentType<Record<string, unknown>>;
const Link = ({children,...props}: React.ComponentProps<'a'>) => React.createElement('a',props,children);
const stub = () => React.createElement('div');
function loadSync(url: URL, dependencies: Record<string,unknown> = {}) {
  const require = createRequire(url), compiledModule = {exports:{} as Record<string,Component>};
  const {outputText} = ts.transpileModule(readFileSync(url,'utf8'),{fileName:fileURLToPath(url),compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
  const resolve = (name:string): unknown => {
    if(name in dependencies) return dependencies[name];
    // Sibling components load from source with the same stand-ins.
    if(name.startsWith('./') && existsSync(fileURLToPath(new URL(`${name}.tsx`,url)))) return loadSync(new URL(`${name}.tsx`,url),dependencies);
    return require(name);
  };
  new Function('require','module','exports',outputText)(resolve,compiledModule,compiledModule.exports);
  return compiledModule.exports;
}
async function load(path: string, dependencies: Record<string,unknown> = {}) { return loadSync(new URL(path,import.meta.url),dependencies); }
const shared = {
  'next/link':{__esModule:true,default:Link}, 'next/navigation':{useRouter:()=>({push(){},refresh(){}}),usePathname:()=>'/inventory'}, '@/lib/inventory/movement-form':movementForm, '@/lib/inventory/movement-history':movementHistory, '@/lib/inventory/category-form':categoryForm,
  '@/lib/inventory/access':access, '@/lib/inventory/presentation':presentation,
  '@/lib/inventory/types':types,
  '@/lib/inventory/product-request-submission':submission, '@/lib/inventory/action-validation':validation,
  '@/lib/inventory/actions':{}, '@/lib/inventory/product-edit':productEdit, '@/lib/inventory/save-errors':saveErrors, '@/lib/inventory/request-presentation':requests, '@/lib/inventory/photo-upload':{},
};
const html = (component:Component,props:Record<string,unknown>) => renderToStaticMarkup(React.createElement(component,props));

test('overview and products show a full-width Add item link for only managers and warehouse staff',async()=>{
  const dependencies = {...shared,'./product-type-tabs':{ProductTypeTabs:stub},'./product-filters':{ProductFilters:stub},'./product-list-view':{ProductListView:stub}};
  const overview = (await load('../../components/inventory/overview-view.tsx',dependencies)).InventoryOverviewView;
  const browser = (await load('../../components/inventory/products-browser.tsx',dependencies)).ProductsBrowser;
  const state = presentation.parseInventoryProductParams({}).state;
  for(const role of ['system_owner','admin_manager','warehouse_staff','viewer','designer','sales_designer','sales_coordinator','procurement_manager','unknown',null]) {
    for(const [component,props] of [[overview,{overview:previewOverview}],[browser,{result:{items:[],total:0,page:1,page_count:0},counts:{product:0,accessory:0,temporary:0},state,brands:[],categories:[]}]] as const) {
      const markup=html(component,{...props,role});
      const allowed=['system_owner','admin_manager','warehouse_staff'].includes(role ?? '');
      assert.equal(markup.includes('href="/inventory/requests/new-product"'),allowed,String(role));
      if(allowed) {
        const addLink=markup.match(/<a[^>]*href="\/inventory\/requests\/new-product"[^>]*>(?:(?!<\/a>).)*Add item<\/a>/)?.[0];
        assert.ok(addLink);assert.match(addLink,/class="[^"]*min-h-11[^"]*"/);assert.match(addLink,/bg-emerald-900/);
      }
    }
  }
});
test('add form shows manager Add item title and submit, while warehouse submits Send request',async()=>{
  const form=(await load('../../components/inventory/product-request-form.tsx',{...shared,'./request-photo-picker':{RequestPhotoPicker:stub},'./product-image-gallery':{ProductImageGallery:stub}})).ProductRequestForm;
  for(const role of ['system_owner','admin_manager','warehouse_staff']) {
    const markup=html(form,{role,brands:previewBrands,categories:previewCategories});
    assert.match(markup,/Stock ref: auto-generated when saved/);
    assert.doesNotMatch(markup,/<input[^>]*name="stock_ref"/);
    for(const name of ['item_code','model_name']) {
      const input=markup.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`));
      assert.ok(input, name);assert.doesNotMatch(input[0],/required/);
    }
    if(role==='warehouse_staff') assert.match(markup,/>Send request<\/button>/);
    else {assert.match(markup,/<h1[^>]*>Add item<\/h1>/);assert.match(markup,/>Add item<\/button>/);assert.doesNotMatch(markup,/Add-item request/);}
  }
});
test('add and review forms explain the submitted read-only total and put location inputs immediately below it',async()=>{
  const form=(await load('../../components/inventory/product-request-form.tsx',{...shared,'./request-photo-picker':{RequestPhotoPicker:stub},'./product-image-gallery':{ProductImageGallery:stub}})).ProductRequestForm;
  const review={...previewProductRequests[0],quantity:5,initial_stock:{warehouse:2,mockup:3}};
  for(const [role,request] of [['warehouse_staff',undefined],['admin_manager',undefined],['system_owner',undefined],['admin_manager',review]] as const) {
    const markup=html(form,{role,request,brands:previewBrands,categories:previewCategories});
    assert.match(markup,/Total quantity \(from locations below\)/);
    const quantity=markup.match(/<input[^>]*name="quantity"[^>]*>/)?.[0];
    assert.ok(quantity);assert.match(quantity,/readOnly=""/);assert.doesNotMatch(quantity,/disabled/);
    assert.match(quantity,/bg-zinc-100/);
    assert.match(quantity,new RegExp(`value="${request ? 5 : 1}"`));
    const helpId=quantity.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(helpId);
    assert.ok(markup.includes(`<p id="${helpId}"`));
    assert.match(markup,/Change the numbers in Initial stock by location below\./);
    assert.match(markup,/name="quantity"[^>]*><\/label><p[^>]*>Change the numbers in Initial stock by location below\.<\/p><\/div><section[^>]*><h2[^>]*>Initial stock by location<\/h2>/);
    const stock=markup.indexOf('>Initial stock by location</h2>');
    assert.ok(stock<markup.indexOf('name="requested_status"'));
    assert.ok(stock<markup.indexOf('name="condition"'));
    assert.equal((markup.match(/name="stock_/g)??[]).length,5);
  }
});
test('product page booking controls distinguish direct actions from requests',async()=>{
  const tools=await load('../../components/inventory/product-manager-tools.tsx',{...shared,'./request-dialog':{RequestDialog:stub}});
  const actions=(await load('../../components/inventory/movement-request-form.tsx',{...shared,'./request-dialog':{RequestDialog:stub},'./product-manager-tools':tools})).ProductRequestActions;
  for(const role of ['system_owner','admin_manager','procurement_manager','designer','sales_designer','sales_coordinator']) {
    const markup=html(actions,{product:previewProduct,role});
    for(const kind of ['book','hold'] as const) assert.ok(markup.includes(`>${requests.movementSubmitLabel(role,kind)}</button>`));
  }
  for(const role of ['viewer','warehouse_staff']) assert.doesNotMatch(html(actions,{product:previewProduct,role}),/>Book now|>Hold now|>Request book|>Request hold/);
});
test('manager destination preserves a photo-upload warning without hiding the added product',async()=>{
  const page=(await load('../../app/inventory/products/[id]/page.tsx',{
    ...shared,'next/navigation':{notFound(){throw new Error('Not found');}},
    '@/lib/auth':{requireInventoryUser:async()=>({profile:{role:'admin_manager'},user:{id:'manager'}})},
    '@/lib/inventory/queries':{getProduct:async()=>previewProduct,getPendingProductMovementRequests:async()=>[]},
    '@/components/inventory/product-detail-view':{ProductDetailView:()=>React.createElement('p',null,'Saved product')},
    '@/components/inventory/movement-request-form':{ProductRequestActions:stub},
    '@/components/inventory/pending-product-requests':{PendingProductRequests:stub},
  })).default as unknown as (props:object)=>Promise<React.ReactNode>;
  for(const photoFailures of [undefined,'2','invalid']) {
    const markup=renderToStaticMarkup(await page({params:Promise.resolve({id:previewProduct.id}),searchParams:Promise.resolve({photoFailures})}));
    assert.match(markup,/Saved product/);
    assert.equal(markup.includes('some photos could not be attached'),photoFailures==='2');
  }
});
test('cards and detail put the stock reference directly below the name and omit missing item codes',async()=>{
  const product={...previewProduct,stock_ref:'02-0001',item_code:null,model_name:null,main_image_url:null};
  const card=(await load('../../components/inventory/product-card.tsx',shared)).ProductCard;
  const cardMarkup=html(card,{product});
  assert.match(cardMarkup,/<\/h2><p[^>]*><span[^>]*>02-0001<\/span>/);
  assert.doesNotMatch(cardMarkup,/Code:|>—<|>null<|>undefined</);
  const detail=(await load('../../components/inventory/product-detail-view.tsx',{...shared,'./product-reservations':{ProductReservations:stub},'./product-image-gallery':{ProductImageGallery:stub},'./stock-by-location':{StockByLocation:stub}})).ProductDetailView;
  const detailMarkup=html(detail,{product});
  assert.match(detailMarkup,/Stock reference<\/dt><dd[^>]*>02-0001<\/dd>/);
  assert.match(detailMarkup,/<\/h2><p[^>]*>02-0001<\/p>/);
  assert.doesNotMatch(detailMarkup,/Item code|Code:/);
  assert.doesNotMatch(detailMarkup,/>null<|>undefined</);
  for(const item_code of ['', '   ', '1234']) {
    for(const [component,props] of [[card,{product:{...product,item_code}}],[detail,{product:{...product,item_code}}]] as const) {
      const markup=html(component,props);
      assert.equal(markup.includes('Code: 1234'),item_code==='1234');
      if(item_code!=='1234') assert.doesNotMatch(markup,/Code:|Item code/);
    }
  }
  const requestsView=(await load('../../components/inventory/requests-view.tsx',{...shared,'@/lib/inventory/request-reads':{},'./product-image-gallery':{ProductImageGallery:stub},'./request-dialog':{RequestDialog:stub},'./product-request-form':{ProductRequestForm:stub}})).RequestsView;
  const requestMarkup=html(requestsView,{products:[{...previewProductRequests[0],stock_ref:null,item_code:null,model_name:null}],movements:[],tab:'products',status:'pending_review',mine:false,userId:'viewer',role:'viewer',page:1,pageCount:1,total:1});
  assert.match(requestMarkup,/— · —/);assert.doesNotMatch(requestMarkup,/>null<|>undefined</);
});

test('photo cards lead with a cover image and show only nonzero stock locations as compact labelled chips',async()=>{
  const card=(await load('../../components/inventory/product-card.tsx',shared)).ProductCard;
  const markup=html(card,{product:{...previewProduct,mockup_quantity:0,temporary_out_quantity:0}});
  assert.match(markup,/aspect-\[4\/3\]/);
  assert.match(markup,/<img[^>]*class="object-cover"/);
  assert.ok(markup.indexOf('<img')<markup.indexOf('<h2'));
  assert.match(markup,/focus-visible:outline/);
  for(const label of ['Warehouse: 12','Dubai Showroom: 3']) {
    assert.ok(markup.includes(`aria-label="${label}"`),label);
    assert.ok(markup.includes(`title="${label}"`),label);
  }
  // Four non-zero places: two chips plus "+2", whose label names the ones folded away.
  assert.match(markup,/aria-label="2 more: Abu Dhabi Showroom: 2, Sold \(cumulative\): 8"/); assert.ok(markup.includes('>+2<'));
  assert.doesNotMatch(markup,/Mockup|Temporary Out|grid-cols-3/);
  for(const text of ['17 live','14 avail','3 res.']) assert.ok(markup.includes(text),text);
});
test('product cards: brand on the photo, one compact stats line, reserved 0 hidden, same photo ratio, zero locations hidden',async()=>{
  const card=(await load('../../components/inventory/product-card.tsx',shared)).ProductCard;
  const render=(patch:object)=>html(card,{product:{...previewProduct,...patch}});
  const markup=render({brand_name:'Nora Office'});
  const photo=markup.slice(markup.indexOf('data-card-photo'),markup.indexOf('</h2>')+5);
  assert.match(markup,/data-card-brand[^>]*>.*Nora Office/);
  assert.ok(markup.indexOf('data-card-brand')<markup.indexOf('<h2'));          // label sits on the photo, before the text area
  assert.match(photo,/data-card-brand/); assert.match(photo,/backdrop-blur/); assert.match(photo,/rounded-full/); assert.match(photo,/border-white/);
  assert.equal(markup.indexOf('Nora Office',markup.indexOf('</h2>')),-1);       // not repeated in the text area
  assert.match(markup,/<h2[^>]*line-clamp-2[^>]*text-\[13px\]|<h2[^>]*text-\[13px\][^>]*line-clamp-2/);
  const none=render({brand_name:null});
  assert.doesNotMatch(none,/data-card-brand|Brand not specified/);
  // reserved 0 never shows; reserved above 0 shows one amber "N res."
  const zero=render({reserved_quantity:0,available_quantity:17});
  assert.doesNotMatch(zero,/Reserved|res\./); assert.ok(zero.includes('17 live')); assert.ok(zero.includes('17 avail'));
  assert.ok(render({reserved_quantity:2,available_quantity:15}).includes('2 res.'));
  // one stats line carries live, available and the status word
  assert.match(zero,/data-card-stats[^>]*>.*17 live.*17 avail.*Available/);
  // same photo box on every card, with or without a photo
  const ratio=(m:string)=>m.match(/data-card-photo[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-card-photo/)?.slice(1).find(Boolean);
  assert.equal(ratio(markup),ratio(render({main_image_url:null,brand_name:'A very long brand name that should be cut off before it breaks the card'})));
  assert.match(ratio(markup)!,/aspect-\[4\/3\]/);
  // cards in a row share one height: the card fills its grid cell
  assert.match(markup,/class="group flex h-full min-h-11/);
  // location chips: zeros hidden, at most three plus +N
  const chips=render({warehouse_quantity:4,dubai_showroom_quantity:0,abudhabi_showroom_quantity:0,mockup_quantity:0,temporary_out_quantity:0,sold_quantity:0});
  assert.ok(chips.includes('aria-label="Warehouse: 4"')); assert.doesNotMatch(chips,/Dubai|Abu Dhabi|>\+\d/);
  const many=render({warehouse_quantity:1,dubai_showroom_quantity:1,abudhabi_showroom_quantity:1,mockup_quantity:1,temporary_out_quantity:1,sold_quantity:1});
  assert.equal((many.match(/<li /g) ?? []).length,3); assert.ok(many.includes('>+4<'));
  const three=render({warehouse_quantity:1,dubai_showroom_quantity:1,abudhabi_showroom_quantity:1,mockup_quantity:0,temporary_out_quantity:0,sold_quantity:0});
  assert.equal((three.match(/<li /g) ?? []).length,3); assert.doesNotMatch(three,/>\+\d/);
  assert.match(many,/flex-nowrap/);
});

test('missing photos use a distinct item-type icon and product lists fit two columns on phones',async()=>{
  const cardModule=await load('../../components/inventory/product-card.tsx',shared);
  for(const [item_type,icon] of [['product','package'],['accessory','puzzle'],['temporary','clock']] as const) {
    const markup=html(cardModule.ProductCard,{product:{...previewProduct,item_type,main_image_url:null}});
    assert.match(markup,new RegExp(`lucide-${icon}`));
    assert.match(markup,/No image/);assert.doesNotMatch(markup,/<img/);
  }
  const list=(await load('../../components/inventory/product-list-view.tsx',{...shared,'@/components/inventory/product-card':cardModule})).ProductListView;
  const markup=html(list,{products:[previewProduct],filtered:false});
  assert.match(markup,/grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4/);
});

test('every Overview card is the same whole-card link with a View hint',async()=>{
  const overview = (await load('../../components/inventory/overview-view.tsx',shared)).InventoryOverviewView;
  const markup = html(overview,{overview:previewOverview,role:'system_owner'});
  const cards = [...markup.matchAll(/<a [^>]*data-overview-card[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  // Units, Products, Reserved, Low stock, 2 pending request cards, 6 locations.
  assert.equal(cards.length,12);
  const hrefs = cards.map(card => card.match(/href="([^"]+)"/)![1].replaceAll('&amp;','&'));
  assert.ok(hrefs.includes('/inventory/requests?tab=products&status=pending_review'));
  assert.ok(hrefs.includes('/inventory/requests?tab=movements&status=pending_review'));
  const classOf = (card:string) => card.match(/class="([^"]+)"/)![1];
  const base = (card:string) => classOf(card).split(' ').filter(name => !/^(border|bg|shadow)/.test(name)).join(' ');
  for(const card of cards) {
    assert.equal(base(card),base(cards[0]));
    assert.match(classOf(card),/min-h-11/); assert.match(classOf(card),/hover:/); assert.match(classOf(card),/focus-visible:outline/);
    assert.match(card,/aria-hidden="true"[^>]*>(<span class="hidden sm:inline">View<\/span>)?<svg/);
    assert.match(card,/<dt class="[^"]*text-sm[^"]*"/);
    assert.doesNotMatch(card,/underline/);
  }
  const standard = cards.filter(card => !card.includes('text-4xl'));
  assert.equal(standard.length,10);
  for(const card of standard) assert.match(card,/<dd class="[^"]*text-2xl/);
  assert.equal(markup.match(/<a [^>]*underline/g)?.length ?? 0,0);
});

test('Edit item, Manage photos and Remove item show only for System Owner and Admin Manager',async()=>{
  const tools=await load('../../components/inventory/product-manager-tools.tsx',{...shared,'./request-dialog':{RequestDialog:stub}});
  const actions=(await load('../../components/inventory/movement-request-form.tsx',{...shared,'./request-dialog':{RequestDialog:stub},'./product-manager-tools':tools})).ProductRequestActions;
  for(const role of ['system_owner','admin_manager','procurement_manager','designer','sales_designer','sales_coordinator','warehouse_staff','viewer','unknown',null]) {
    const markup=html(actions,{product:previewProduct,role});
    const manager=['system_owner','admin_manager'].includes(role ?? '');
    for(const label of ['Edit item','Manage photos','Remove item']) assert.equal(markup.includes(label),manager,`${role} ${label}`);
    assert.equal(markup.includes(`/inventory/products/${previewProduct.id}/edit`),manager);
    assert.equal(markup.includes(`/inventory/products/${previewProduct.id}/photos`),manager);
  }
});
test('edit form shows stock ref and quantity read-only, and costs only to managers',async()=>{
  const form=(await load('../../components/inventory/product-edit-form.tsx',shared)).ProductEditForm;
  const props={product:previewProduct,brands:previewBrands,categories:previewCategories,productHref:'/p'};
  for(const role of ['system_owner','admin_manager']) {
    const markup=html(form,{...props,role});
    assert.match(markup,/<input[^>]*readOnly=""[^>]*name="stock_ref_display"/);
    assert.match(markup,/<input[^>]*readOnly=""[^>]*name="quantity_display"/);
    assert.ok(markup.includes('Change stock with Take / Move stock.'));
    assert.doesNotMatch(markup,/name="stock_ref"|name="quantity"/);
    for(const name of ['price','freight_cost','c_and_f','transport','custom_duty','labour','vat','item_name','item_code','model_name','low_stock_at','dimension_length']) assert.ok(markup.includes(`name="${name}"`),name);
  }
  for(const role of ['warehouse_staff','viewer','designer',null]) {
    const markup=html(form,{...props,role});
    assert.doesNotMatch(markup,/name="price"|name="item_name"|<form/);
  }
});
test('photo manager shows add controls until three photos, and nothing to other roles',async()=>{
  const manager=(await load('../../components/inventory/product-photo-manager.tsx',{...shared,'./request-dialog':{RequestDialog:stub},'next/image':{__esModule:true,default:(props:Record<string,unknown>)=>React.createElement('img',{alt:String(props.alt)})}})).ProductPhotoManager;
  const images=previewProduct.images;
  const props={productId:previewProduct.id,productName:'Chair',productHref:'/p'};
  const full=html(manager,{...props,images:images.slice(0,3),role:'admin_manager'});
  assert.ok(full.includes('(3/3)')); assert.match(full,/maximum of three photos/);
  assert.equal((full.match(/<input[^>]*type="file"[^>]*disabled=""/g) ?? []).length,2);
  const two=html(manager,{...props,images:images.slice(0,2),role:'admin_manager'});
  assert.ok(two.includes('(2/3)')); assert.doesNotMatch(two,/<input[^>]*type="file"[^>]*disabled=""/);
  assert.match(two,/accept="image\/jpeg,image\/png,image\/webp"/); assert.ok(two.includes('Set as main')); assert.ok(two.includes('Remove photo 1'));
  assert.doesNotMatch(html(manager,{...props,images,role:'warehouse_staff'}),/Set as main|type="file"/);
});

test('Move stock and Manage categories shortcuts, and the Movements tab, show only to managers',async()=>{
  const overview = (await load('../../components/inventory/overview-view.tsx',shared)).InventoryOverviewView;
  const browser = (await load('../../components/inventory/products-browser.tsx',{...shared,'./product-type-tabs':{ProductTypeTabs:stub},'./product-filters':{ProductFilters:stub},'./product-list-view':{ProductListView:stub}})).ProductsBrowser;
  const nav = (await load('../../components/inventory/inventory-nav.tsx',shared)).InventoryNav;
  const state = presentation.parseInventoryProductParams({}).state;
  for(const role of ['system_owner','admin_manager','warehouse_staff','viewer','designer','sales_designer','sales_coordinator','procurement_manager','unknown',null]) {
    const manager=['system_owner','admin_manager'].includes(role ?? '');
    for(const markup of [html(overview,{overview:previewOverview,role}),html(browser,{result:{items:[],total:0,page:1,page_count:0},counts:{all:0,product:0,accessory:0,temporary:0},state,brands:[],categories:[],role})]) {
      assert.equal(markup.includes('href="/inventory/move"'),manager,String(role));
      assert.equal(markup.includes('href="/inventory/categories"'),manager,String(role));
    }
    const tabs=html(nav,{showMovements:manager});
    assert.equal(tabs.includes('href="/inventory/movements"'),manager);
    assert.ok(tabs.includes('href="/inventory/requests"'));
  }
});
test('Move, Movements and Categories screens give other roles a permission message and no controls',async()=>{
  const dialog={RequestDialog:stub};
  const move=(await load('../../components/inventory/move-stock-form.tsx',{...shared,'next/image':{__esModule:true,default:stub}})).MoveStockForm;
  const movements=(await load('../../components/inventory/movements-view.tsx',{...shared,'next/image':{__esModule:true,default:stub}})).MovementsView;
  const categories=(await load('../../components/inventory/category-manager.tsx',{...shared,'./request-dialog':dialog})).CategoryManager;
  const picker=previewPickerProducts[0], page={items:previewMovementHistory,total:3,page:1,page_count:1,page_size:24};
  const state=movementHistory.parseMovementParams({}).state;
  for(const role of ['warehouse_staff','viewer','designer','sales_designer','sales_coordinator','procurement_manager','unknown',null]) {
    for(const markup of [html(move,{role,initialProduct:picker}),html(movements,{role,result:page,state}),html(categories,{role,categories:previewCategoryOverview})]) {
      assert.match(markup,/do not have permission/); assert.doesNotMatch(markup,/<form|<input|<table|Save movement|Add category/);
    }
  }
  for(const role of ['system_owner','admin_manager']) {
    const form=html(move,{role,initialProduct:picker,initialQuantity:'2'});
    assert.ok(form.includes('Move between locations')); assert.ok(form.includes('Save movement')); assert.match(form,/After saving/);
    assert.doesNotMatch(form,/price|cost|vat/i);
    const list=html(movements,{role,result:page,state});
    assert.ok(list.includes('<table')); assert.ok(list.includes('Received')); assert.ok(list.includes('Moved')); assert.ok(list.includes('Sold')); assert.ok(list.includes('Stock request'));
    const cats=html(categories,{role,categories:previewCategoryOverview});
    assert.ok(cats.includes('Add category')); assert.ok(cats.includes('Add subcategory')); assert.ok(cats.includes('Rename')); assert.ok(cats.includes('Hidden')); assert.doesNotMatch(cats,/Delete/);
  }
});
test('Move stock blocks Save and shows the preview and plain-words error',async()=>{
  const move=(await load('../../components/inventory/move-stock-form.tsx',{...shared,'next/image':{__esModule:true,default:stub}})).MoveStockForm;
  const picker={...previewPickerProducts[0],warehouse_quantity:10,dubai_showroom_quantity:1,quantity:11,reserved_quantity:3,available_quantity:8};
  const ok=html(move,{role:'admin_manager',initialProduct:picker,initialQuantity:'3'});
  assert.ok(ok.includes('Warehouse')); assert.doesNotMatch(ok,/<button[^>]*disabled=""[^>]*>Save movement/);
  const blocked=html(move,{role:'admin_manager',initialProduct:picker,initialQuantity:'9'});
  assert.ok(blocked.includes('Only 8 units are available; 3 are reserved.')); assert.match(blocked,/<button[^>]*disabled=""[^>]*>Save movement/);
});
test('Requests tab has a search box that keeps the URL state and explains who can be searched',async()=>{
  const view=(await load('../../components/inventory/requests-view.tsx',{...shared,'./product-image-gallery':{ProductImageGallery:stub},'./request-dialog':{RequestDialog:stub},'./product-request-form':{ProductRequestForm:stub},'@/lib/inventory/request-reads':{loadProductRequestImages:async()=>[]}})).RequestsView;
  const props={products:[],movements:[],tab:'movements',status:'all',mine:false,userId:'u',page:1,pageCount:1,total:0};
  const manager=html(view,{...props,role:'admin_manager',q:'chair'});
  assert.match(manager,/<input[^>]*name="q"[^>]*value="chair"/); assert.ok(manager.includes('Search by product, stock ref, item code, model or person.')); assert.match(manager,/placeholder="Search requests"/);
  assert.match(manager,/name="tab" value="movements"/); assert.match(manager,/name="status" value="all"/); assert.ok(manager.includes('Clear search'));
  const staff=html(view,{...props,role:'warehouse_staff',q:''});
  assert.ok(staff.includes('Search by product, stock ref, item code or model.')); assert.doesNotMatch(staff,/or person/); assert.doesNotMatch(staff,/Clear search/);
});
test('the new pages send non-managers away before reading anything',async()=>{
  const redirects:string[]=[]; let reads=0;
  const navigation={notFound(){throw new Error('Not found');},redirect(path:string){redirects.push(path);throw new Error('redirect');}};
  const queriesMock={getProduct:async()=>{reads++;return null;},listMovements:async()=>{reads++;return {items:[],total:0,page:1,page_count:1,page_size:24};},listCategoryOverview:async()=>{reads++;return [];}};
  for(const [path,role] of [['move','viewer'],['movements','warehouse_staff'],['categories','designer'],['movements',null],['categories','procurement_manager']] as const) {
    const pageModule=await load(`../../app/inventory/${path}/page.tsx`,{...shared,'next/navigation':navigation,'@/lib/auth':{requireInventoryUser:async()=>({profile:{role},user:{id:'u'}})},'@/lib/inventory/queries':queriesMock,
      '@/components/inventory/move-stock-form':{MoveStockForm:stub},'@/components/inventory/movements-view':{MovementsView:stub},'@/components/inventory/category-manager':{CategoryManager:stub},'@/lib/inventory/page-range-error':{InventoryPageRangeError:class extends Error{}}});
    await assert.rejects(()=>(pageModule.default as unknown as (props:object)=>Promise<unknown>)({searchParams:Promise.resolve({})}),/redirect/);
  }
  assert.equal(redirects.length,5); assert.ok(redirects.every(path=>path==='/inventory')); assert.equal(reads,0);
});

test('shared Inventory components: badge, empty state, pager, banner and sticky bar',async()=>{
  const ui=await load('../../components/inventory/inventory-ui.tsx',shared);
  const badge=html(ui.Badge as Component,{tone:'warn',children:'Pending'});
  assert.match(badge,/data-badge="warn"/); assert.ok(badge.includes('Pending'));
  const empty=html(ui.EmptyState as Component,{title:'No products found',text:'Nothing matches your search.',action:{href:'/inventory/products',label:'Clear filters'}});
  assert.equal((empty.match(/<h2/g) ?? []).length,1); assert.equal((empty.match(/<a /g) ?? []).length,1); assert.ok(empty.includes('Clear filters'));
  assert.equal((html(ui.EmptyState as Component,{title:'No products yet',text:'Added products show here.'}).match(/<a /g) ?? []).length,0);
  const pager=html(ui.Pager as Component,{label:'Pages',page:1,pageCount:3,previousHref:null,nextHref:'/next'});
  assert.match(pager,/1 \/ 3/); assert.match(pager,/aria-disabled="true"[^>]*>Previous/); assert.match(pager,/href="\/next"[^>]*>Next/);
  assert.match(html(ui.Banner as Component,{tone:'error',children:'No connection.'}),/role="alert"/);
  assert.match(html(ui.Banner as Component,{tone:'success',children:'Saved.'}),/role="status"/);
  const bar=html(ui.StickyActionBar as Component,{reason:'Enter a quantity to continue.',children:React.createElement('button',null,'Save')});
  assert.match(bar,/data-sticky-bar/); assert.match(bar,/sticky bottom-0/); assert.match(bar,/pr-24/); assert.match(bar,/env\(safe-area-inset-bottom\)/); assert.ok(bar.includes('Enter a quantity to continue.'));
  assert.equal(html(ui.StickyActionBar as Component,{children:'x'}).includes('data-disabled-reason'),false);
  for(const name of ['primary','secondary','danger','quiet'] as const) assert.match((ui.buttonClass as unknown as Record<string,string>)[name],/min-h-11/);
});
test('every Inventory page keeps clear of the floating assistant',async()=>{
  const frame=(await load('../../components/inventory/inventory-frame.tsx',shared)).InventoryFrame;
  const markup=html(frame,{children:'x'});
  assert.match(markup,/data-inventory-frame/); assert.ok(markup.includes('pb-[calc(6rem+env(safe-area-inset-bottom))]'));
});
test('compact toolbar: one primary Add item, Move stock beside it, categories in the More menu',async()=>{
  const actions=(await load('../../components/inventory/inventory-actions.tsx',shared)).InventoryActions;
  for(const role of ['system_owner','admin_manager']) {
    const markup=html(actions,{role});
    assert.equal((markup.match(/bg-emerald-900/g) ?? []).length,1);
    assert.match(markup,/href="\/inventory\/requests\/new-product"[^>]*>(?:(?!<\/a>).)*Add item/);
    assert.match(markup,/href="\/inventory\/move"[^>]*>(?:(?!<\/a>).)*Move stock/);
    const menu=markup.match(/<div role="menu"[^>]*>.*?<\/div>/)?.[0] ?? '';
    assert.match(menu,/hidden=""/); assert.ok(menu.includes('Manage categories')); assert.ok(menu.includes('href="/inventory/categories"'));
    assert.equal(markup.replace(menu,'').includes('Manage categories'),false);
    assert.match(markup,/aria-label="More"/);
  }
  const staff=html(actions,{role:'warehouse_staff'});
  assert.ok(staff.includes('Add item')); assert.equal(staff.includes('Move stock'),false); assert.equal(staff.includes('role="menu"'),false);
  for(const role of ['viewer','designer','sales_designer','procurement_manager',null]) assert.equal(html(actions,{role}),'');
});
test('More menu opens on demand and labels its button',async()=>{
  const {MoreMenu}=await load('../../components/inventory/inventory-ui-client.tsx',shared);
  const items=[{href:'/a',label:'Alpha'}];
  const closed=html(MoreMenu as Component,{items}), open=html(MoreMenu as Component,{items,defaultOpen:true});
  assert.match(closed,/aria-expanded="false"/); assert.match(closed,/<div role="menu"[^>]*hidden=""/);
  assert.match(open,/aria-expanded="true"/); assert.doesNotMatch(open,/<div role="menu"[^>]*hidden=""/);
  assert.match(open,/role="menuitem"[^>]*class="[^"]*min-h-11/);
  assert.equal(html(MoreMenu as Component,{items:[]}),'');
});
test('type tabs and the top tabs scroll with fade hints and mark the current tab',async()=>{
  const tabs=(await load('../../components/inventory/product-type-tabs.tsx',shared)).ProductTypeTabs;
  const state=presentation.parseInventoryProductParams({itemType:'accessory'}).state;
  const markup=html(tabs,{state,counts:{all:5,product:2,accessory:2,temporary:1}});
  assert.match(markup,/data-fade="left"/); assert.match(markup,/data-fade="right"/); assert.match(markup,/overflow-x-auto/);
  assert.match(markup,/aria-current="page"[^>]*>(?:(?!<\/a>).)*Accessories/);
  assert.equal((markup.match(/min-h-11/g) ?? []).length,4);
  const nav=html((await load('../../components/inventory/inventory-nav.tsx',shared)).InventoryNav,{showMovements:true});
  assert.match(nav,/data-fade="right"/); assert.equal((nav.match(/min-h-11/g) ?? []).length,4);
});
test('product search is short and clear, with filters and sort in a sheet',async()=>{
  const filters=(await load('../../components/inventory/product-filters.tsx',{...shared,'./request-dialog':{RequestDialog:stub}})).ProductFilters;
  const state=presentation.parseInventoryProductParams({q:'chair',location:'warehouse'}).state;
  const markup=html(filters,{state,brands:previewBrands,categories:previewCategories});
  assert.match(markup,/placeholder="Search products"/); assert.match(markup,/type="search"/); assert.match(markup,/inputMode="search"/);
  assert.match(markup,/aria-haspopup="dialog"[^>]*>(?:(?!<\/button>).)*Filters/);
  assert.doesNotMatch(markup,/Sort by/);
  assert.ok(markup.includes('Search: chair')); assert.ok(markup.includes('Location: Warehouse')); assert.ok(markup.includes('Clear filters'));
});
test('long forms keep their save button in a sticky bar with the reason it is disabled',async()=>{
  const move=(await load('../../components/inventory/move-stock-form.tsx',{...shared,'next/image':{__esModule:true,default:stub}})).MoveStockForm;
  const empty=html(move,{role:'admin_manager',initialProduct:previewPickerProducts[0]});
  assert.match(empty,/data-sticky-bar/); assert.ok(empty.includes('Enter a quantity to continue.')); assert.match(empty,/<button[^>]*disabled=""[^>]*>Save movement/);
  const edit=(await load('../../components/inventory/product-edit-form.tsx',shared)).ProductEditForm;
  assert.match(html(edit,{product:previewProduct,brands:previewBrands,categories:previewCategories,role:'admin_manager',productHref:'/p'}),/data-sticky-bar/);
  const add=(await load('../../components/inventory/product-request-form.tsx',{...shared,'next/image':{__esModule:true,default:stub}})).ProductRequestForm;
  assert.match(html(add,{brands:previewBrands,categories:previewCategories,role:'admin_manager',preview:true}),/data-sticky-bar/);
});
test('requests use a 44px My requests chip, a short placeholder and a slim pager',async()=>{
  const view=(await load('../../components/inventory/requests-view.tsx',{...shared,'./product-image-gallery':{ProductImageGallery:stub},'./request-dialog':{RequestDialog:stub},'./product-request-form':{ProductRequestForm:stub},'@/lib/inventory/request-reads':{loadProductRequestImages:async()=>[]}})).RequestsView;
  const markup=html(view,{products:[],movements:[],tab:'products',status:'all',mine:true,userId:'u',page:2,pageCount:3,total:0,role:'admin_manager',q:''});
  assert.match(markup,/placeholder="Search requests"/); assert.match(markup,/min-h-11[^"]*"[^>]*>(?:(?!<\/a>).)*My requests/);
  assert.doesNotMatch(markup,/type="checkbox"/); assert.match(markup,/2 \/ 3/); assert.ok(markup.includes('No requests found'));
});
