const Customer=require('../../models/customer.model');
const Card=require('../../models/card.model');
const access=require('./card.controller');
module.exports.list=(req,res)=>access.authenticate(req,res,async()=>{
  try{
    if(!req.cardActor.permissions.some(permission=>['card-view','card-issue'].includes(permission)))return res.status(403).render('admin/pages/no-permission',{pageTitle:'Quản lý khách hàng',message:'Bạn không có quyền sử dụng tính năng này!'});
    const keyword=typeof req.query.keyword==='string'?req.query.keyword.trim().slice(0,120):'';
    const query={deleted:false,status:'active'};
    if(keyword){const escaped=keyword.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');query.$or=['fullName','email','phone'].map(field=>({[field]:{$regex:escaped,$options:'i'}}));}
    const customers=await Customer.find(query).select('_id fullName email phone avatar').sort({createdAt:-1}).limit(200).lean();
    const cards=await Card.find({ownerId:{$in:customers.map(customer=>String(customer._id))},cardType:'customer',isCurrent:true}).select('ownerId cardId status').lean();
    const current=new Map(cards.map(card=>[card.ownerId,card]));
    res.render('admin/pages/user-list',{pageTitle:'Quản lý khách hàng',customers:customers.map(customer=>({...customer,card:current.get(String(customer._id))})),keyword});
  }catch{res.status(500).send('Không thể tải danh sách khách hàng.');}
});
