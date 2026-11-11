const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const bcrypt=require('bcryptjs');
const db=require('../helpers/db');
const Account=require('../../models/account-admin.model');
const controller=require('../../controllers/admin/setting.controller');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
before(async()=>{global.pathAdmin='admin';if(db.enabled){await db.connect();await Account.init();}});
beforeEach(async()=>{if(db.enabled)await db.reset();});
after(async()=>{if(db.enabled)await db.close();});
function response(){return {out:[],json(data){this.out.push(data);return this;},redirect(url){this.out.push({redirect:url});}};}
const request=(body,extra={})=>({body,account:{id:'0123456789abcdef01234567'},flash(){},...extra});

// Người có quyền sửa tài khoản không được tắt yêu cầu thẻ nhân viên hay đổi trạng thái xoá qua body.
it('account edit ignores cardRequired and other non-form fields but keeps the form password change',async()=>{
  const staff=await Account.create({fullName:'Nhân viên',email:'staff@example.invalid',password:await bcrypt.hash('OldPass1!',4),status:'active',role:'r1',cardRequired:true});
  const res=response();
  await controller.accountAdminEditPatch(request({fullName:'Nhân viên mới',email:'staff@example.invalid',phone:'0901234567',role:'r2',positionCompany:'Kế toán',status:'active',password:'NewPass1!',cardRequired:'false',deleted:'true',deletedBy:'x',createdBy:'x'},{params:{id:staff.id}}),res);
  assert.deepEqual(res.out,[{code:'success'}]);
  const stored=await Account.findById(staff.id).lean();
  assert.equal(stored.cardRequired,true);
  assert.equal(stored.deleted,false);
  assert.equal(stored.deletedBy,undefined);
  assert.equal(stored.createdBy,undefined);
  assert.equal(stored.fullName,'Nhân viên mới');
  assert.equal(stored.role,'r2');
  assert.equal(stored.positionCompany,'Kế toán');
  assert.ok(await bcrypt.compare('NewPass1!',stored.password));
  // Không gửi password thì giữ nguyên mật khẩu cũ như form hiện tại.
  await controller.accountAdminEditPatch(request({fullName:'Nhân viên mới',status:'inactive',cardRequired:false},{params:{id:staff.id}}),response());
  const again=await Account.findById(staff.id).lean();
  assert.equal(again.status,'inactive');assert.equal(again.cardRequired,true);assert.ok(await bcrypt.compare('NewPass1!',again.password));
});
it('account create never accepts cardRequired, deleted or operator objects from the body',async()=>{
  const res=response();
  await controller.accountAdminCreatePost(request({fullName:'Mới',email:'new@example.invalid',phone:'0901',role:'r1',positionCompany:'NV',status:'active',password:'NewPass1!',cardRequired:'true',deleted:'true'}),res);
  assert.deepEqual(res.out,[{code:'success'}]);
  const stored=await Account.findOne({email:'new@example.invalid'}).lean();
  assert.equal(stored.cardRequired,false);assert.equal(stored.deleted,false);assert.equal(stored.createdBy,'0123456789abcdef01234567');
  assert.ok(await bcrypt.compare('NewPass1!',stored.password));
  const bad=response();
  await controller.accountAdminCreatePost(request({fullName:'X',email:{$ne:null},password:'NewPass1!'}),bad);
  assert.equal(bad.out[0].code,'error');
  assert.equal(await Account.countDocuments(),1);
});
