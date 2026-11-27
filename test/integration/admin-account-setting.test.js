const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const bcrypt=require('bcryptjs');
const db=require('../helpers/db');
const Account=require('../../models/account-admin.model');
const Role=require('../../models/role.model');
const controller=require('../../controllers/admin/setting.controller');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
before(async()=>{global.pathAdmin='admin';if(db.enabled){await db.connect();await Account.init();}});
beforeEach(async()=>{if(db.enabled)await db.reset();});
after(async()=>{if(db.enabled)await db.close();});
function response(){return {out:[],json(data){this.out.push(data);return this;},redirect(url){this.out.push({redirect:url});}};}
const request=(body,extra={})=>({body,account:{id:'0123456789abcdef01234567'},flash(){},...extra});

// Người có quyền sửa tài khoản không được tắt yêu cầu thẻ nhân viên hay đổi trạng thái xoá qua body.
it('account edit ignores cardRequired and other non-form fields but keeps the form password change',async()=>{
  const [original,assigned]=await Role.create([{name:'Role gốc'},{name:'Role chuyển'}]);
  const staff=await Account.create({fullName:'Nhân viên',email:'staff@example.com',password:await bcrypt.hash('OldPass1!',4),status:'active',role:original.id,cardRequired:true});
  const res=response();
  await controller.accountAdminEditPatch(request({fullName:'Nhân viên mới',email:'staff@example.com',phone:'0901234567',role:assigned.id,positionCompany:'Kế toán',status:'active',password:'NewPass1!',cardRequired:'false',deleted:'true',deletedBy:'x',createdBy:'x'},{params:{id:staff.id}}),res);
  assert.deepEqual(res.out,[{code:'success'}]);
  const stored=await Account.findById(staff.id).lean();
  assert.equal(stored.cardRequired,true);
  assert.equal(stored.deleted,false);
  assert.equal(stored.deletedBy,undefined);
  assert.equal(stored.createdBy,undefined);
  assert.equal(stored.fullName,'Nhân viên mới');
  assert.equal(stored.role,assigned.id);
  assert.equal(stored.sessionVersion,1);
  assert.equal(stored.positionCompany,'Kế toán');
  assert.ok(await bcrypt.compare('NewPass1!',stored.password));
  // Không gửi password thì giữ nguyên mật khẩu cũ như form hiện tại.
  await controller.accountAdminEditPatch(request({fullName:'Nhân viên mới',status:'inactive',cardRequired:false},{params:{id:staff.id}}),response());
  const again=await Account.findById(staff.id).lean();
  assert.equal(again.status,'inactive');assert.equal(again.cardRequired,true);assert.ok(await bcrypt.compare('NewPass1!',again.password));
});
it('account create never accepts cardRequired, deleted or operator objects from the body',async()=>{
  const role=await Role.create({name:'Role hợp lệ'});
  const res=response();
  await controller.accountAdminCreatePost(request({fullName:'Mới',email:'new@example.com',phone:'0901',role:role.id,positionCompany:'NV',status:'active',password:'NewPass1!',cardRequired:'true',deleted:'true'}),res);
  assert.deepEqual(res.out,[{code:'success'}]);
  const stored=await Account.findOne({email:'new@example.com'}).lean();
  assert.equal(stored.cardRequired,false);assert.equal(stored.deleted,false);assert.equal(stored.createdBy,'0123456789abcdef01234567');
  assert.ok(await bcrypt.compare('NewPass1!',stored.password));
  const bad=response();
  await controller.accountAdminCreatePost(request({fullName:'X',email:{$ne:null},password:'NewPass1!'}),bad);
  assert.equal(bad.out[0].code,'error');
  assert.equal(await Account.countDocuments(),1);
});

it('role edits retain the same membership and revoke its sessions for either ObjectId casing',async()=>{
  const role=await Role.create({name:'Role fixture',permissions:['order-view']});
  const member=await Account.create({email:'member@example.com',role:role.id.toUpperCase(),status:'active'});
  const res=response();
  await controller.roleEditPatch(request({name:role.name,permissions:[]},{
    params:{id:role.id.toUpperCase()},permissions:['role-edit','order-view']
  }),res);
  assert.deepEqual(res.out,[{code:'success'}]);
  assert.equal((await Account.findById(member.id)).sessionVersion,1);
});

it('account edits preserve usable login credentials when the requested email, password or role is invalid',async()=>{
  const role=await Role.create({name:'Role fixture'});
  const target=await Account.create({email:'target@example.com',role:role.id,status:'active',password:await bcrypt.hash('OldPass1!',4)});
  await Account.create({email:'occupied@example.com',role:role.id,status:'active'});
  for(const body of [{email:''},{email:'OCCUPIED@example.com'},{password:'weak'},{role:'1'.repeat(24)}]){
    const res=response();
    await controller.accountAdminEditPatch(request(body,{params:{id:target.id}}),res);
    assert.equal(res.out[0].code,'error');
  }
  const stored=await Account.findById(target.id);
  assert.equal(stored.email,'target@example.com');
  assert.equal(stored.role,role.id);
  assert.equal(stored.sessionVersion,0);
  assert.ok(await bcrypt.compare('OldPass1!',stored.password));
});
