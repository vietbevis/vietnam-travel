/**
 * Vietnam Travel / Java Card: safe, deterministic, SYNTHETIC demo data.
 * Copy this file into the PROJECT ROOT beside package.json.
 * Preview: node seed-vietnam-travel-demo.cjs --preview
 * Apply:   node seed-vietnam-travel-demo.cjs --apply
 * Export:  node seed-vietnam-travel-demo.cjs --export
 * Profiles: --profile balanced (default) | rich | massive
 * Requires MongoDB replica set 'rsdemo' at 127.0.0.1:27019 and DB vietnam-travel-smartcard-demo.
 * NEVER touches Card/CardTransaction/CardOperation/CardLog, or existing admin accounts.
 */
'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const SEED='VT_SMARTCARD_DEMO_2026_V1';
const DB_NAME='vietnam-travel-smartcard-demo';
const RS_NAME='rsdemo';
const DOMESTIC_ID='67fd050210c7084c1076f7cf'; // homepage hardcoded category ID
const DAY=86400000, VN_OFFSET=7*3600000;
const args=process.argv.slice(2);
const profileArg=args.includes('--profile')?args[args.indexOf('--profile')+1]:'balanced';
const profiles={balanced:{slots:3,customers:500,orders:850,contacts:120},rich:{slots:4,customers:850,orders:1500,contacts:240},massive:{slots:6,customers:1600,orders:3200,contacts:400}};
if(!profiles[profileArg]){console.error('Profile không hợp lệ. Dùng balanced, rich hoặc massive.');process.exit(1);}
const profile=profiles[profileArg];
const mode=args.includes('--apply')?'apply':args.includes('--export')?'export':'preview';
const oidHex=key=>crypto.createHash('sha256').update('VT-DEMO-2026:'+key).digest('hex').slice(0,24);
const objectId=(key)=>({$oid:oidHex(key)});
const alphaSlug=s=>s.toLowerCase().replace(/đ/g,'d').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
function rand(seed){let t=seed>>>0;return ()=>{t+=0x6d2b79f5;let z=t;z=Math.imul(z^(z>>>15),z|1);z^=z+Math.imul(z^(z>>>7),z|61);return ((z^(z>>>14))>>>0)/4294967296;};}
const rng=rand(20261111);const n=(a,b)=>a+Math.floor(rng()*(b-a+1));
const pick=a=>a[Math.floor(rng()*a.length)];
const pad=x=>String(x).padStart(2,'0');
const vnStart=(at)=>{const d=new Date(at.getTime()+VN_OFFSET);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-VN_OFFSET);};
const vnDate=d=>{const u=new Date(d.getTime()+VN_OFFSET);return `${pad(u.getUTCDate())}/${pad(u.getUTCMonth()+1)}/${u.getUTCFullYear()}`;};
const vnd=x=>new Intl.NumberFormat('vi-VN').format(x)+' đ';
const escapeHtml=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const imgIds={
 mountain:['photo-1464822759023-fed622ff2c3b','photo-1506905925346-21bda4d32df4','photo-1519681393784-d120267933ba','photo-1470770841072-f978cf4d019e'],
 nature:['photo-1441974231531-c6227db76b6e','photo-1470252649378-9c29740c9fa8','photo-1500534623283-312aade485b7','photo-1448375240586-882707db888b'],
 beach:['photo-1507525428034-b723cf961d3e','photo-1519046904884-53103b34b206','photo-1473116763249-2faaef81ccda','photo-1500375592092-40eb2168fd21'],
 city:['photo-1519501025264-65ba15a82390','photo-1480714378408-67cf0d13bc1b','photo-1514565131-fce0801e5785','photo-1477959858617-67f85cf4f1df'],
 culture:['photo-1533676802871-eca1ae998cd5','photo-1493976040374-85c8e12f0c0e','photo-1528360983277-13d401cdc186','photo-1513519245088-0e12902e5a38'],
 international:['photo-1480796927426-f609979314bd','photo-1523906834658-6e24ef2386f9','photo-1499856871958-5b9627545d1a','photo-1527631746610-bca00a040d60']
};
const images=(kind,routeIndex)=>{
 const pool=imgIds[kind]||imgIds.nature;
 // Stable CDN image URLs; display photos are illustrative, NOT certified location photos.
 return [0,1,2].map(j=>`https://images.unsplash.com/${pool[(routeIndex+j)%pool.length]}?auto=format&fit=crop&w=${j===0?1200:960}&q=80`);
};
// Category keys and parents reflect actual Category model (parent: string of ObjectId).
const CATS=[
 ['domestic','Tour Trong Nước','',100],
 ['north','Du lịch miền Bắc','domestic',94],['northwest','Tây Bắc và mùa lúa chín','north',92],
 ['northeast','Đông Bắc và cung đường biên giới','north',90],['northbay','Biển đảo miền Bắc','north',88],
 ['northheritage','Di sản và tâm linh miền Bắc','north',86],
 ['central','Du lịch miền Trung','domestic',83],['centralheritage','Di sản miền Trung','central',82],
 ['centralbeach','Biển đảo miền Trung','central',80],['centralnature','Thiên nhiên miền Trung','central',78],
 ['highland','Tây Nguyên và cao nguyên','domestic',76],
 ['south','Du lịch miền Nam','domestic',74],['southbeach','Biển đảo phía Nam','south',72],
 ['mekong','Miền Tây sông nước','south',70],['southeast','Đông Nam Bộ','south',68],
 ['foreign','Tour Nước Ngoài','',65],['japan','Nhật Bản','foreign',64],['korea','Hàn Quốc','foreign',62],
 ['thailand','Thái Lan','foreign',60],['asean','Singapore - Malaysia','foreign',58],
 ['indonesia','Indonesia - Bali','foreign',56],['greaterchina','Đài Loan - Trung Quốc - Hong Kong','foreign',54],
 ['europe','Châu Âu','foreign',52],['australia','Úc và New Zealand','foreign',50],
 ['middleeast','Trung Đông - Ai Cập - Thổ Nhĩ Kỳ','foreign',48],
 ['themes','Tour Theo Chủ Đề','',46],['family','Gia đình và nghỉ dưỡng','themes',44],
 ['adventure','Trekking và khám phá','themes',42],['honeymoon','Trăng mật và cặp đôi','themes',40],
 ['weekend','Tour cuối tuần','themes',38]
];
const cityNames=['Hà Nội','TP. Hồ Chí Minh','Đà Nẵng','Hải Phòng','Cần Thơ','Huế','Hạ Long','Sa Pa','Lào Cai','Hà Giang','Cao Bằng','Ninh Bình','Mộc Châu','Mai Châu','Yên Bái','Tam Đảo','Thanh Hóa','Nghệ An','Quảng Bình','Hội An','Quảng Ngãi','Quy Nhơn','Tuy Hòa','Nha Trang','Phan Rang','Phan Thiết','Đà Lạt','Buôn Ma Thuột','Pleiku','Măng Đen','Vũng Tàu','Hồ Tràm','Phú Quốc','Côn Đảo','Bến Tre','Châu Đốc','Hà Tiên','Cà Mau','Sóc Trăng','Bạc Liêu','Tây Ninh','Lạng Sơn','Bắc Kạn','Đồng Hới','Rạch Giá','Tokyo','Osaka','Seoul','Bangkok','Singapore','Kuala Lumpur','Bali','Đài Bắc','Bắc Kinh','Thượng Hải','Paris','Rome','Sydney','Dubai','Istanbul'];
// [title, category, nights+days, adult VND, origin, stops (comma-separated), image kind, vehicle]
const ROUTES=[
 ['Sa Pa - Fansipan - bản Cát Cát','northwest',3,2890000,'Hà Nội','Hà Nội,Sa Pa,bản Cát Cát,Fansipan','mountain','Xe du lịch, cáp treo'],
 ['Hà Giang - Đồng Văn - Mã Pí Lèng','northeast',4,4390000,'Hà Nội','Hà Nội,Quản Bạ,Yên Minh,Đồng Văn,Mã Pí Lèng','mountain','Xe du lịch'],
 ['Mù Cang Chải - Tú Lệ - đèo Khau Phạ','northwest',3,3290000,'Hà Nội','Hà Nội,Tú Lệ,Khau Phạ,Mù Cang Chải','mountain','Xe du lịch'],
 ['Mộc Châu - Tà Xùa săn mây','northwest',3,2790000,'Hà Nội','Hà Nội,Mộc Châu,Tà Xùa','mountain','Xe du lịch'],
 ['Mai Châu - Pù Luông - bản Đôn','northwest',3,2990000,'Hà Nội','Hà Nội,Mai Châu,Pù Luông','nature','Xe du lịch'],
 ['Cao Bằng - thác Bản Giốc - động Ngườm Ngao','northeast',4,4290000,'Hà Nội','Hà Nội,Cao Bằng,thác Bản Giốc,động Ngườm Ngao','nature','Xe du lịch'],
 ['Hồ Ba Bể - ATK Định Hóa','northeast',3,2690000,'Hà Nội','Hà Nội,Bắc Kạn,hồ Ba Bể,ATK Định Hóa','nature','Xe du lịch, thuyền'],
 ['Lạng Sơn - Mẫu Sơn - chợ Kỳ Lừa','northeast',2,1890000,'Hà Nội','Hà Nội,Lạng Sơn,Mẫu Sơn,chợ Kỳ Lừa','mountain','Xe du lịch'],
 ['Hạ Long - vịnh Lan Hạ - du thuyền','northbay',3,4890000,'Hà Nội','Hà Nội,vịnh Hạ Long,vịnh Lan Hạ,đảo Cát Bà','beach','Xe du lịch, du thuyền'],
 ['Cát Bà - vịnh Lan Hạ - làng Việt Hải','northbay',3,3490000,'Hải Phòng','Hải Phòng,đảo Cát Bà,vịnh Lan Hạ,làng Việt Hải','beach','Xe du lịch, tàu'],
 ['Ninh Bình - Tràng An - Hang Múa','northheritage',2,1790000,'Hà Nội','Hà Nội,Tràng An,Hang Múa,cố đô Hoa Lư','nature','Xe du lịch, thuyền'],
 ['Bái Đính - Tràng An - Tam Cốc','northheritage',2,1690000,'Hà Nội','Hà Nội,chùa Bái Đính,Tràng An,Tam Cốc','culture','Xe du lịch, thuyền'],
 ['Yên Tử - chùa Ba Vàng','northheritage',2,1590000,'Hà Nội','Hà Nội,Yên Tử,chùa Ba Vàng','culture','Xe du lịch, cáp treo'],
 ['Tam Đảo - Tây Thiên nghỉ dưỡng','north',2,1890000,'Hà Nội','Hà Nội,Tam Đảo,Tây Thiên','mountain','Xe du lịch'],
 ['Thanh Hóa - biển Sầm Sơn - Thành Nhà Hồ','northbay',3,2590000,'Hà Nội','Hà Nội,Thành Nhà Hồ,Sầm Sơn','beach','Xe du lịch'],
 ['Nghệ An - Cửa Lò - quê Bác','northheritage',3,2790000,'Hà Nội','Hà Nội,Kim Liên,Cửa Lò','culture','Xe du lịch'],
 ['Huế - Đại Nội - lăng Tự Đức','centralheritage',3,3590000,'Đà Nẵng','Đà Nẵng,Huế,Đại Nội,lăng Tự Đức','culture','Xe du lịch'],
 ['Đà Nẵng - Bà Nà Hills - Hội An','centralheritage',4,4490000,'Đà Nẵng','Đà Nẵng,Bà Nà Hills,phố cổ Hội An','city','Xe du lịch, cáp treo'],
 ['Hội An - thánh địa Mỹ Sơn - Cù Lao Chàm','centralheritage',3,3290000,'Đà Nẵng','Đà Nẵng,Hội An,thánh địa Mỹ Sơn,Cù Lao Chàm','culture','Xe du lịch, canô'],
 ['Quảng Bình - Phong Nha - Động Thiên Đường','centralnature',4,4690000,'Hà Nội','Đồng Hới,Phong Nha,Động Thiên Đường,sông Chày','nature','Máy bay, xe du lịch'],
 ['Quảng Bình - Tú Làn - Hang Én','centralnature',4,6590000,'Hà Nội','Đồng Hới,Tú Làn,Hang Én','nature','Máy bay, xe du lịch, đi bộ'],
 ['Lý Sơn - đảo Bé - cổng Tò Vò','centralbeach',3,3890000,'Đà Nẵng','Quảng Ngãi,đảo Lý Sơn,đảo Bé,cổng Tò Vò','beach','Xe du lịch, tàu cao tốc'],
 ['Quy Nhơn - Kỳ Co - Eo Gió','centralbeach',4,4590000,'TP. Hồ Chí Minh','Quy Nhơn,Kỳ Co,Eo Gió,tháp Đôi','beach','Máy bay, xe du lịch'],
 ['Phú Yên - Ghềnh Đá Đĩa - Mũi Điện','centralbeach',4,4390000,'TP. Hồ Chí Minh','Tuy Hòa,Ghềnh Đá Đĩa,Mũi Điện,Bãi Xép','beach','Máy bay, xe du lịch'],
 ['Nha Trang - Hòn Mun - VinWonders','centralbeach',4,4990000,'TP. Hồ Chí Minh','Nha Trang,Hòn Mun,VinWonders,Tháp Bà Ponagar','beach','Máy bay, xe du lịch, canô'],
 ['Ninh Thuận - Vĩnh Hy - Hang Rái','centralbeach',3,3590000,'TP. Hồ Chí Minh','Phan Rang,vịnh Vĩnh Hy,Hang Rái,vườn nho','beach','Xe du lịch, tàu'],
 ['Mũi Né - Bàu Trắng - làng chài','centralbeach',3,2990000,'TP. Hồ Chí Minh','Phan Thiết,Mũi Né,Bàu Trắng,làng chài','beach','Xe du lịch'],
 ['Đà Lạt - Langbiang - hồ Tuyền Lâm','highland',4,3990000,'TP. Hồ Chí Minh','Đà Lạt,Langbiang,hồ Tuyền Lâm,thung lũng Tình Yêu','mountain','Xe du lịch'],
 ['Đà Lạt săn mây - đồi chè Cầu Đất','highland',3,3190000,'TP. Hồ Chí Minh','Đà Lạt,Cầu Đất,đồi chè,săn mây','nature','Xe du lịch'],
 ['Buôn Ma Thuột - Buôn Đôn - hồ Lắk','highland',4,3890000,'TP. Hồ Chí Minh','Buôn Ma Thuột,Buôn Đôn,hồ Lắk,thác Dray Nur','nature','Máy bay, xe du lịch'],
 ['Pleiku - Biển Hồ - Kon Tum','highland',4,4290000,'Đà Nẵng','Pleiku,Biển Hồ,Kon Tum,nhà rông','nature','Xe du lịch'],
 ['Măng Đen - thác Pa Sỹ - hồ Đăk Ke','highland',3,3390000,'Đà Nẵng','Măng Đen,thác Pa Sỹ,hồ Đăk Ke','mountain','Xe du lịch'],
 ['Củ Chi - núi Bà Đen - Tây Ninh','southeast',2,1790000,'TP. Hồ Chí Minh','địa đạo Củ Chi,Tây Ninh,núi Bà Đen','culture','Xe du lịch, cáp treo'],
 ['Vũng Tàu - Bạch Dinh - Hải đăng','southeast',2,1890000,'TP. Hồ Chí Minh','Vũng Tàu,Bạch Dinh,ngọn hải đăng','beach','Xe du lịch'],
 ['Hồ Tràm - suối nước nóng Bình Châu','southbeach',3,3290000,'TP. Hồ Chí Minh','Hồ Tràm,Bình Châu,rừng Bình Châu','beach','Xe du lịch'],
 ['Phú Quốc - Hòn Thơm - Grand World','southbeach',4,5790000,'TP. Hồ Chí Minh','Phú Quốc,Hòn Thơm,Grand World,Dinh Cậu','beach','Máy bay, xe du lịch, cáp treo'],
 ['Phú Quốc - Nam Đảo - Bãi Sao','southbeach',5,6490000,'Hà Nội','Phú Quốc,Bãi Sao,Nam Đảo,Sunset Town','beach','Máy bay, xe du lịch'],
 ['Côn Đảo - Bãi Đầm Trầu - Hàng Dương','southbeach',3,5290000,'TP. Hồ Chí Minh','Côn Đảo,Bãi Đầm Trầu,Hàng Dương','beach','Máy bay, xe du lịch'],
 ['Cần Thơ - chợ nổi Cái Răng - Mỹ Khánh','mekong',2,1890000,'TP. Hồ Chí Minh','Cần Thơ,chợ nổi Cái Răng,Mỹ Khánh','nature','Xe du lịch, thuyền'],
 ['Bến Tre - Cồn Phụng - miệt vườn','mekong',2,1690000,'TP. Hồ Chí Minh','Bến Tre,Cồn Phụng,miệt vườn','nature','Xe du lịch, xuồng'],
 ['Châu Đốc - Trà Sư - núi Cấm','mekong',3,2890000,'Cần Thơ','Châu Đốc,rừng tràm Trà Sư,núi Cấm','nature','Xe du lịch, thuyền'],
 ['Cà Mau - Đất Mũi - Bạc Liêu','mekong',4,3790000,'Cần Thơ','Sóc Trăng,Bạc Liêu,Cà Mau,Đất Mũi','nature','Xe du lịch, canô'],
 ['Hà Tiên - Rạch Giá - đảo Nam Du','mekong',4,4590000,'Cần Thơ','Rạch Giá,Hà Tiên,đảo Nam Du','beach','Xe du lịch, tàu cao tốc'],
 ['Miền Tây 4 tỉnh - Cồn Sơn - Sóc Trăng','mekong',4,3290000,'TP. Hồ Chí Minh','Bến Tre,Cần Thơ,Cồn Sơn,Sóc Trăng','nature','Xe du lịch, thuyền'],
 ['Tokyo - Phú Sĩ - Hakone','japan',5,25900000,'Hà Nội','Tokyo,núi Phú Sĩ,Hakone','international','Máy bay, tàu điện, xe du lịch'],
 ['Osaka - Kyoto - Nara - Kobe','japan',6,28900000,'TP. Hồ Chí Minh','Osaka,Kyoto,Nara,Kobe','culture','Máy bay, tàu điện, xe du lịch'],
 ['Hokkaido - Sapporo - Otaru','japan',6,32900000,'Hà Nội','Sapporo,Otaru,Hokkaido','mountain','Máy bay, xe du lịch'],
 ['Seoul - đảo Nami - Everland','korea',5,19900000,'Hà Nội','Seoul,đảo Nami,Everland,cung Gyeongbokgung','city','Máy bay, xe du lịch'],
 ['Busan - Gamcheon - Gyeongju','korea',5,20900000,'TP. Hồ Chí Minh','Busan,Gamcheon,Gyeongju','beach','Máy bay, xe du lịch'],
 ['Bangkok - Pattaya - chợ nổi','thailand',5,8490000,'Hà Nội','Bangkok,Pattaya,chợ nổi Bốn Miền','city','Máy bay, xe du lịch'],
 ['Chiang Mai - Chiang Rai - Doi Suthep','thailand',5,10900000,'Hà Nội','Chiang Mai,Chiang Rai,Doi Suthep','culture','Máy bay, xe du lịch'],
 ['Phuket - đảo Phi Phi - vịnh Maya','thailand',5,11900000,'TP. Hồ Chí Minh','Phuket,đảo Phi Phi,vịnh Maya','beach','Máy bay, canô'],
 ['Singapore - Marina Bay - Sentosa','asean',4,11900000,'TP. Hồ Chí Minh','Singapore,Marina Bay,Sentosa,Gardens by the Bay','city','Máy bay, xe du lịch'],
 ['Kuala Lumpur - Genting - Putrajaya','asean',4,9490000,'TP. Hồ Chí Minh','Kuala Lumpur,Genting,Putrajaya','city','Máy bay, xe du lịch'],
 ['Singapore - Malaysia liên tuyến','asean',6,16900000,'Hà Nội','Singapore,Johor Bahru,Malacca,Kuala Lumpur','city','Máy bay, xe du lịch'],
 ['Bali - Ubud - Nusa Penida','indonesia',5,13900000,'TP. Hồ Chí Minh','Bali,Ubud,Nusa Penida,Tanah Lot','beach','Máy bay, xe du lịch'],
 ['Jakarta - Bandung - núi lửa Tangkuban Perahu','indonesia',5,12900000,'TP. Hồ Chí Minh','Jakarta,Bandung,Tangkuban Perahu','nature','Máy bay, xe du lịch'],
 ['Đài Bắc - Cửu Phần - hồ Nhật Nguyệt','greaterchina',5,15900000,'Hà Nội','Đài Bắc,Cửu Phần,hồ Nhật Nguyệt','culture','Máy bay, xe du lịch'],
 ['Bắc Kinh - Vạn Lý Trường Thành','greaterchina',5,18500000,'Hà Nội','Bắc Kinh,Vạn Lý Trường Thành,Tử Cấm Thành','culture','Máy bay, xe du lịch'],
 ['Thượng Hải - Hàng Châu - Ô Trấn','greaterchina',6,19900000,'TP. Hồ Chí Minh','Thượng Hải,Hàng Châu,Ô Trấn','city','Máy bay, tàu cao tốc'],
 ['Hong Kong - Disneyland - Macau','greaterchina',5,22900000,'Hà Nội','Hong Kong,Disneyland,Macau','city','Máy bay, phà'],
 ['Paris - Versailles - thung lũng Loire','europe',8,55900000,'Hà Nội','Paris,Versailles,thung lũng Loire','international','Máy bay, xe du lịch'],
 ['Rome - Florence - Venice','europe',9,60900000,'TP. Hồ Chí Minh','Rome,Florence,Venice','culture','Máy bay, tàu cao tốc'],
 ['Thụy Sĩ - Lucerne - Interlaken','europe',8,69900000,'Hà Nội','Zurich,Lucerne,Interlaken','mountain','Máy bay, tàu điện'],
 ['London - Windsor - Oxford','europe',8,58900000,'Hà Nội','London,Windsor,Oxford','international','Máy bay, xe du lịch'],
 ['Sydney - Blue Mountains - Melbourne','australia',8,49900000,'TP. Hồ Chí Minh','Sydney,Blue Mountains,Melbourne','international','Máy bay, xe du lịch'],
 ['New Zealand - Auckland - Rotorua','australia',9,64900000,'TP. Hồ Chí Minh','Auckland,Rotorua,Waitomo','nature','Máy bay, xe du lịch'],
 ['Dubai - Abu Dhabi - sa mạc Safari','middleeast',6,27900000,'Hà Nội','Dubai,Abu Dhabi,sa mạc Safari','international','Máy bay, xe du lịch'],
 ['Ai Cập - Cairo - kim tự tháp Giza','middleeast',8,45900000,'Hà Nội','Cairo,kim tự tháp Giza,Luxor','culture','Máy bay, xe du lịch'],
 ['Istanbul - Cappadocia - Pamukkale','middleeast',9,49900000,'TP. Hồ Chí Minh','Istanbul,Cappadocia,Pamukkale','international','Máy bay, xe du lịch']
];
const maleFamily=['Nguyễn','Trần','Lê','Phạm','Hoàng','Phan','Vũ','Võ','Đặng','Bùi','Đỗ','Hồ','Ngô','Dương','Lý','Đinh','Đoàn','Mai','Tạ','Trịnh'];
const midMale=['Văn','Đức','Quang','Hữu','Xuân','Minh','Bảo','Đình','Trung'];
const midFemale=['Thị','Ngọc','Thu','Phương','Khánh','Bảo','Thanh','Hoài'];
const givenMale=['An','Bình','Dũng','Hưng','Khánh','Lâm','Long','Mạnh','Minh','Nam','Phong','Quân','Sơn','Thắng','Thành','Thiện','Tùng','Tuấn','Việt'];
const givenFemale=['Anh','Chi','Diệp','Dung','Giang','Hà','Hạnh','Hương','Lan','Linh','Mai','My','Ngân','Nhi','Nhung','Oanh','Phương','Quỳnh','Thảo','Trang','Trâm','Yến'];
const notes=['Khách đặt qua website','Ưu tiên phòng 2 giường','Gia đình có trẻ nhỏ, cần hướng dẫn tập trung','Ưu tiên ghế phía trước','Cần tư vấn chính sách hành lý','Khách đi lần đầu, nhờ xác nhận lịch trình','Đã liên hệ tư vấn qua điện thoại','Đặt theo nhóm bạn','Yêu cầu gọi điện trước ngày khởi hành','Khách quan tâm thực đơn chay','Không có yêu cầu bổ sung'];
function dataset(asOf=new Date()){
 const today=vnStart(asOf);const cfg=profile;const catId=key=>key==='domestic'?DOMESTIC_ID:oidHex('category:'+key);
 const categories=CATS.map(([key,name,parent,position])=>({$key:key,_id:objectId(key==='domestic'?'domestic-fixed':'category:'+key),name,parent:parent?catId(parent):'',slug:alphaSlug(name),position,status:'active',avatar:images(key==='foreign'?'international':key==='domestic'?'beach':'nature',position)[0],description:`<p>Khám phá các hành trình ${escapeHtml(name.toLowerCase())} với lịch trình và mức giá tham khảo dành cho khách hàng Vietnam Travel.</p>`,deleted:false,demoSeed:SEED}));
 // Replace domestic key hash with the exact literal ObjectId in the source project's home.controller.js.
 categories[0]._id={$oid:DOMESTIC_ID};
 const cities=cityNames.map(name=>({_id:objectId('city:'+name),name,demoSeed:SEED}));
 const cityId=name=>oidHex('city:'+name);
 const tours=[];
 ROUTES.forEach((route,ri)=>{
  const [title,category,days,base,origin,stopText,kind,vehicle]=route;
  const stops=stopText.split(',');
  for(let variant=0;variant<cfg.slots;variant++){
   let offset=variant===0?(ri%12===0?0:-(8+(ri*13)%142)):variant===1?2+(ri*2)%21:variant===2?25+(ri*3)%37:variant===3?66+(ri*5)%63:variant===4?135+(ri*3)%38:182+(ri*5)%56;
   const departureDate=new Date(today.getTime()+offset*DAY+8*3600000);
   const priceNewAdult=Math.round(base*(1+(variant%3)*.035)/10000)*10000;
   const oldMarkup=[1.15,1.22,1.12,1.18][ri%4];
   const priceAdult=Math.round(priceNewAdult*oldMarkup/10000)*10000;
   const priceNewChildren=Math.round(priceNewAdult*.75/10000)*10000;
   const priceNewBaby=Math.round(priceNewAdult*.12/10000)*10000;
   const name=`${title} ${days}N${days-1}Đ | KH ${vnDate(departureDate)}`;
   const itinerary=stops.slice(0,days+1);
   const schedules=Array.from({length:days},(_,d)=>{
    const stop=itinerary[Math.min(d,itinerary.length-1)];
    const next=itinerary[Math.min(d+1,itinerary.length-1)];
    return {title:`Ngày ${d+1}: ${stop}${next!==stop?' - '+next:''}`,description:`<p><strong>Buổi sáng:</strong> Tập trung theo lịch hẹn, di chuyển và tham quan ${escapeHtml(stop)}.</p><p><strong>Buổi chiều:</strong> Khám phá ${escapeHtml(next)}, tìm hiểu văn hóa địa phương và chụp ảnh.</p><p><strong>Buổi tối:</strong> Nghỉ ngơi, trải nghiệm ẩm thực địa phương. Chương trình có thể điều chỉnh theo điều kiện thời tiết.</p>`};
   });
   const img=images(kind,ri);
   const information=`<h3>Điểm nổi bật</h3><p>Hành trình ${escapeHtml(title)} khởi hành từ ${escapeHtml(origin)}, thời gian ${days} ngày ${days-1} đêm. Trải nghiệm các điểm đến: ${escapeHtml(stops.join(' – '))}.</p><ul><li>Phương tiện: ${escapeHtml(vehicle)}.</li><li>Hướng dẫn viên và lịch trình theo đoàn.</li><li>Giá tour mang tính chất dữ liệu minh họa; chưa phải báo giá bán thực tế.</li></ul><p><strong>Lưu ý:</strong> Vui lòng xác nhận giấy tờ, dịch vụ bao gồm, bảo hiểm và điều kiện nhập cảnh (nếu đi nước ngoài) trước khi đặt tour thật.</p>`;
   const key=`tour:${ri}:${variant}`;
   tours.push({_id:objectId(key),name,slug:alphaSlug(name),category:catId(category),position:2000-ri*10+variant,status:offset<0?'inactive':'active',avatar:img[0],images:img,priceAdult,priceChildren:Math.round(priceAdult*.75/10000)*10000,priceBaby:Math.round(priceAdult*.12/10000)*10000,priceNewAdult,priceNewChildren,priceNewBaby,stockAdult:ri%9===0?35:45+(ri%6)*6,stockChildren:12+(ri%5)*4,stockBaby:6+(ri%3)*2,locations:[cityId(origin)],time:`${days} Ngày ${days-1} Đêm`,vehicle,departureDate,information,schedules,deleted:false,demoSeed:SEED,$route:ri,$variant:variant});
  }
 });
 const customers=[];
 for(let i=0;i<cfg.customers;i++){
  const sex=i%2===0?'female':'male';
  const name=[maleFamily[i%maleFamily.length],sex==='male'?midMale[(i*3)%midMale.length]:midFemale[(i*5)%midFemale.length],sex==='male'?givenMale[(i*7)%givenMale.length]:givenFemale[(i*9)%givenFemale.length]].join(' ');
  customers.push({_id:objectId('customer:'+i),fullName:name,email:`vt-demo-${String(i+1).padStart(4,'0')}@example.com`,phone:`000${String(i+1).padStart(7,'0')}`,dob:new Date(Date.UTC(1968+(i*7)%37,(i*5)%12,1+(i*11)%28)),gender:sex,demoSeed:SEED,emergencyName:'Liên hệ khẩn cấp (dữ liệu mô phỏng)',emergencyPhone:'0000000000',bloodType:['O+','A+','B+','AB+','O-'][i%5],allergies:i%7===0?'Chưa xác định':'Không khai báo',avatar:'',totalSpent:0,status:'active',deleted:false,createdAt:new Date(today.getTime()-DAY*(300+(i%60))),updatedAt:new Date(today.getTime()-DAY*(i%90))});
 }
 // Paid/non-card orders are SYNTHETIC legacy sales, never actual gateway transactions or card receipts.
 const orderList=[];const after=v=>new Date(v.getTime());
 const customerMap=new Map(customers.map(c=>[c._id.$oid,c]));
 const monthlyDistribution=[];
 for(let i=0;i<cfg.orders;i++){
  const createdAt=new Date(today.getTime()-DAY*(Math.floor((cfg.orders-i)/cfg.orders*240)+n(0,2))+n(7,21)*3600000);
  const eligible=tours.filter(t=>t.departureDate.getTime() >= createdAt.getTime()+2*DAY);
  if(!eligible.length)throw new Error('No eligible future departure for simulated historical order');
  let t=pick(eligible);
  let adult=n(1,3),children=rng()<.25?n(1,2):0,baby=rng()<.055?1:0;
  if(t.stockAdult<adult||t.stockChildren<children||t.stockBaby<baby){t=eligible.find(t=>t.stockAdult>=adult&&t.stockChildren>=children&&t.stockBaby>=baby);}
  if(!t)continue;
  const linked=rng()<.82;
  let customer;
  if(linked){const roll=rng();const idx=roll<.36?n(0,24):roll<.62?n(0,90):n(0,cfg.customers-1);customer=customers[idx];}
  const paid=rng()<.81, cancelled=!paid&&rng()<.24;
  const subTotal=t.priceNewAdult*adult+t.priceNewChildren*children+t.priceNewBaby*baby;
  const spent=customer?.totalSpent||0;
  const percent=spent>=80000000?8:spent>=30000000?5:spent>=10000000?3:0;
  const discount=customer?Math.round(subTotal*percent/100):0;
  const total=subTotal-discount;
  if(paid&&customer)customer.totalSpent+=total;
  t.stockAdult-=adult;t.stockChildren-=children;t.stockBaby-=baby;
  const status=cancelled?'cancel':paid&&t.departureDate.getTime()<today.getTime()?'done':'initial';
  const order={_id:objectId('order:'+i),orderCode:'OD'+String(3000000000+i).padStart(10,'0'),fullName:customer?customer.fullName:([maleFamily[n(0,maleFamily.length-1)],'Văn',givenMale[n(0,givenMale.length-1)]].join(' ')),phone:customer?customer.phone:`000${String(8800000+i).slice(-7)}`,note:pick(notes),items:[{tourId:t._id.$oid,name:t.name,avatar:t.avatar,priceNewAdult:t.priceNewAdult,priceNewChildren:t.priceNewChildren,priceNewBaby:t.priceNewBaby,quantityAdult:adult,quantityChildren:children,quantityBaby:baby,locationFrom:t.locations[0],departureDate:after(t.departureDate),ticketStatus:'none'}],subTotal,discount,total,paymentMethod:pick(['money','bank','bank','money']),paymentStatus:paid?'paid':'unpaid',status,createdAt,updatedAt:new Date(Math.min(Date.now(),createdAt.getTime()+n(1,48)*3600000)),deleted:false,demoSeed:SEED};
  if(customer)order.customerId=customer._id.$oid;
  orderList.push(order);
 }
 // Future tour stock reflects legacy reservations. The seeded orders are not written to any chip.
 const contacts=Array.from({length:cfg.contacts},(_,i)=>({_id:objectId('contact:'+i),email:`newsletter-vt-demo-${String(i+1).padStart(4,'0')}@example.com`,deleted:false,createdAt:new Date(today.getTime()-DAY*n(2,210)),demoSeed:SEED}));
 return {asOf:asOf.toISOString(),profile:profileArg,categories,cities,tours,customers,orders:orderList,contacts};
}
function assertData(data){
 const id=x=>x.$oid;const catids=new Set(data.categories.map(x=>id(x._id)));const tourMap=new Map(data.tours.map(t=>[id(t._id),t]));const cityIds=new Set(data.cities.map(x=>id(x._id)));
 for(const [name,rows] of Object.entries({categories:data.categories,cities:data.cities,tours:data.tours,customers:data.customers,orders:data.orders,contacts:data.contacts})){
  const ids=rows.map(r=>id(r._id));if(new Set(ids).size!==ids.length)throw new Error('Duplicated _id in '+name);
 }
 if(!catids.has(DOMESTIC_ID))throw new Error('Hardcoded domestic category missing');
 if(new Set(data.categories.map(x=>x.slug)).size!==data.categories.length)throw new Error('Duplicate category slug');
 if(new Set(data.tours.map(x=>x.slug)).size!==data.tours.length)throw new Error('Duplicate tour slug');
 for(const t of data.tours){if(!catids.has(t.category)||!t.locations.every(x=>cityIds.has(x)))throw new Error('Broken tour reference');if(![t.stockAdult,t.stockChildren,t.stockBaby,t.priceNewAdult,t.priceNewChildren,t.priceNewBaby].every(x=>Number.isSafeInteger(x)&&x>=0))throw new Error('Invalid price or stock');if(t.schedules.length!==Number(t.time.split(' ')[0]))throw new Error('Invalid schedule length');}
 const byCustomer=new Map(data.customers.map(x=>[id(x._id),0]));
 for(const o of data.orders){const t=tourMap.get(o.items[0].tourId);if(!t)throw new Error('Missing tour from order');if(o.total!==o.subTotal-o.discount)throw new Error('Price mismatch');if(o.paymentMethod==='card'||o.items.some(x=>x.ticketStatus!=='none'))throw new Error('Fake card receipt/ticket not allowed');if(o.customerId){if(!byCustomer.has(o.customerId))throw new Error('Invalid owner');if(o.paymentStatus==='paid')byCustomer.set(o.customerId,byCustomer.get(o.customerId)+o.total);}}
 for(const c of data.customers)if(c.totalSpent!==byCustomer.get(id(c._id)))throw new Error('Member totalSpent mismatch');
 return {categories:data.categories.length,cities:data.cities.length,tours:data.tours.length,customers:data.customers.length,orders:data.orders.length,contacts:data.contacts.length,paidOrders:data.orders.filter(x=>x.paymentStatus==='paid').length,paidRevenue:data.orders.filter(x=>x.paymentStatus==='paid').reduce((s,x)=>s+x.total,0),tiers:{standard:data.customers.filter(x=>x.totalSpent<10000000).length,silver:data.customers.filter(x=>x.totalSpent>=10000000&&x.totalSpent<30000000).length,gold:data.customers.filter(x=>x.totalSpent>=30000000&&x.totalSpent<80000000).length,platinum:data.customers.filter(x=>x.totalSpent>=80000000).length}};
}
const convert=(value,ObjectId)=>{
 if(Array.isArray(value))return value.map(x=>convert(x,ObjectId));
 if(value instanceof Date)return value;
 if(value&&typeof value==='object'){
  if(Object.keys(value).length===1&&typeof value.$oid==='string')return new ObjectId(value.$oid);
  return Object.fromEntries(Object.entries(value).filter(([k])=>!k.startsWith('$route')&&!k.startsWith('$variant')&&!k.startsWith('$key')).map(([k,v])=>[k,convert(v,ObjectId)]));
 }
 return value;
};
async function apply(data,summary){
 const dotenv=require('dotenv');dotenv.config({path:path.resolve(process.cwd(),'.env')});
 const mongoose=require('mongoose');
 const uri=process.env.DATABASE||'';
 if(!/^mongodb:\/\/127\.0\.0\.1:27019\/vietnam-travel-smartcard-demo\?(?:[^\s]*)directConnection=true(?:[^\s]*)$/.test(uri))throw new Error('DỪNG: DATABASE phải trỏ đúng 127.0.0.1:27019/vietnam-travel-smartcard-demo?directConnection=true');
 const connection=await mongoose.createConnection(uri,{serverSelectionTimeoutMS:9000}).asPromise();
 try{
  if(connection.name!==DB_NAME)throw new Error('DỪNG: database không phải demo');
  const hello=await connection.db.admin().command({hello:1});
  if(hello.setName!==RS_NAME||hello.isWritablePrimary!==true)throw new Error('DỪNG: Replica Set rsdemo PRIMARY không hoạt động');
  const admin=await connection.db.collection('accounts-admin').findOne({status:'active',deleted:false});
  if(!admin)throw new Error('DỪNG: chưa có admin active. Hãy tạo admin qua website và kích hoạt trước.');
  const collectionNames=['categories','cities','tours','customers','orders','contacts'];
  const counts=await Promise.all(collectionNames.map(n=>connection.db.collection(n).countDocuments({})));
  if(counts.some(x=>x>0)){
   const existing=Object.fromEntries(collectionNames.map((name,i)=>[name,counts[i]]));
   const tagged=await connection.db.collection('categories').countDocuments({demoSeed:SEED});
   if(tagged>0){console.log('Bộ seed đã tồn tại, dừng an toàn. Số bản ghi hiện tại:',JSON.stringify(existing));return;}
   throw new Error('DỪNG: DB demo đã có dữ liệu nghiệp vụ không phải seed. Không ghi chồng: '+JSON.stringify(existing));
  }
  // Create empty namespaces and schema-compatible unique slug indexes before the data transaction.
  // MongoDB versions/topologies can reject implicit namespace creation inside a transaction.
  const existingCollections=new Set((await connection.db.listCollections({},{nameOnly:true}).toArray()).map(x=>x.name));
  for(const col of [...collectionNames,'roles','setting-website-info'])if(!existingCollections.has(col))await connection.db.createCollection(col);
  await connection.db.collection('categories').createIndex({slug:1},{unique:true});
  await connection.db.collection('tours').createIndex({slug:1},{unique:true});
  const session=await connection.startSession();
  try{
   await session.withTransaction(async()=>{
    for(const col of collectionNames){
     let arr=data[col].map(x=>convert(x,mongoose.Types.ObjectId));
     if(['categories','tours'].includes(col))arr=arr.map((x,i)=>({...x,createdBy:String(admin._id),updatedBy:String(admin._id),createdAt:new Date(new Date(data.asOf).getTime()-DAY*(col==='tours'?305:430)+(i%7)*3600000),updatedAt:new Date(new Date(data.asOf).getTime()-DAY*(col==='tours'?n(2,120):n(30,300)))}));
     await connection.db.collection(col).insertMany(arr,{session,ordered:true});
    }
    // Demo role definitions only. Do NOT create accounts or alter user's admin role.
    const roleDefs=[
      {name:'Demo - Bán tour',description:'Quản lý tour và đơn hàng',permissions:['dashboard-view','tour-view','tour-create','tour-edit','order-view','order-edit']},
      {name:'Demo - Phát hành thẻ',description:'Phát hành và hỗ trợ thẻ',permissions:['dashboard-view','card-view','card-issue','card-edit','card-lock','card-reset-pin','card-log-view']},
      {name:'Demo - Thu ngân',description:'Nạp tiền mặt và giám sát ví',permissions:['dashboard-view','card-view','card-topup','card-log-view','order-view']},
      {name:'Demo - Check-in',description:'Kiểm soát vé tại điểm đến',permissions:['dashboard-view','card-view','card-checkin']},
      {name:'Demo - Giám sát',description:'Quyền xem dữ liệu và nhật ký',permissions:['dashboard-view','card-view','card-log-view','order-view','tour-view']}
    ];
    for(const role of roleDefs)await connection.db.collection('roles').updateOne(
      {name:role.name},{$setOnInsert:{...role,deleted:false,createdBy:String(admin._id),createdAt:new Date(),demoSeed:SEED}},{upsert:true,session}
    );
    const settings=connection.db.collection('setting-website-info');
    const existing=await settings.findOne({}, {session});
    if(!existing)await settings.insertOne({websiteName:'Vietnam Travel – Smart Card Demo',phone:'',email:'',address:'Dữ liệu mô phỏng phục vụ học tập',logo:'/assets/images/logo.png',favicon:'/assets/images/logo.png',demoSeed:SEED},{session});
    else await settings.updateOne({_id:existing._id},{$set:{...(existing.logo?{}:{logo:'/assets/images/logo.png'}),...(existing.favicon?{}:{favicon:'/assets/images/logo.png'}),...(existing.websiteName?{}:{websiteName:'Vietnam Travel – Smart Card Demo'})}},{session});
   },{readPreference:'primary',writeConcern:{w:'majority'},maxCommitTimeMS:25000});
  } finally {await session.endSession();}
  console.log('✓ NẠP DỮ LIỆU THÀNH CÔNG vào',DB_NAME);
  console.log(JSON.stringify(summary,null,2));
  console.log('Không tạo Card, CardTransaction, CardOperation, CardLog, PIN hay biên nhận giả.');
  console.log('Mở http://localhost:3000 (hoặc restart Node để xem kết quả).');
 }finally{await connection.close();}
}
(async()=>{
 const data=dataset();const summary=assertData(data);
 console.log('Vietnam Travel synthetic demo data | '+data.profile+' | '+data.asOf);
 console.log(JSON.stringify(summary,null,2));
 if(mode==='preview'){
  console.log('Đang PREVIEW: chưa kết nối / chưa ghi MongoDB.');
  console.log('Dùng --apply để nạp vào database demo sau khi kiểm tra.');
 }else if(mode==='export'){
  const outdir=path.resolve(process.cwd(),'.superpowers','seed-preview');
  fs.mkdirSync(outdir,{recursive:true});
  const outfile=path.join(outdir,'vietnam-travel-demo-'+profileArg+'.json');
  fs.writeFileSync(outfile,JSON.stringify({meta:{seed:SEED,summary,notice:'SYNTHETIC educational data; not actual bookings or paid gateways'},...data},null,2),'utf8');
  console.log('Đã xuất JSON tham khảo:',outfile,'(chưa ghi MongoDB).');
 }else await apply(data,summary);
})().catch(e=>{console.error('\nSEED FAILED:',e.message);process.exitCode=1;});
