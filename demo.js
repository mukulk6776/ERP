export function seedSchoolDemo(db,today,fail){
 if(db.prepare("SELECT value FROM settings WHERE key='demo_seed'").get())return;
 const occupied=['customers','products','orders','fees','classes','staff','invoices','expenses','admissions','books','loans','routes','transport_assignments','notices','exams','marks','timetable','payroll','homework','submissions','leave_requests'];
 if(occupied.some(table=>db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()))fail('Sample data can only be loaded into an empty school. Existing records have been preserved.',409);
 const day=today(),year=Number(day.slice(0,4));
 const offset=n=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const insert=(table,row)=>{const keys=Object.keys(row);return Number(db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row)).lastInsertRowid);};
 const given=['Aarav','Ananya','Vihaan','Diya','Ishaan','Saanvi','Arjun','Myra','Kabir','Aadhya','Reyansh','Ira','Advik','Kiara','Dhruv','Avni','Shaurya','Tara'];
 const surnames=['Sharma','Gupta','Singh','Verma','Mehta','Kapoor','Joshi','Malhotra'];
 const teacherNames=['Anjali Sharma','Rohit Verma','Pooja Mehta','Vikram Singh','Neha Gupta','Amit Joshi','Kavita Rao','Sanjay Kapoor','Ritu Malhotra','Deepak Sethi','Priya Nair','Manoj Kumar'];
 const subjects=['English','Mathematics','Science','Social Studies','Hindi','Computer Science'];
 db.exec('BEGIN IMMEDIATE');
 try{
  const staff=teacherNames.map((name,i)=>insert('staff',{name,email:`staff${i+1}@school.example`,phone:`900000${String(i+1).padStart(4,'0')}`,designation:i<8?'Class teacher':i===8?'Librarian':i===9?'Sports teacher':i===10?'Accounts officer':'Office administrator',department:i<8?subjects[i%6]:'School office',joined_on:`${year-3}-04-01`,base_salary:(28000+i*1500)*100}));
  const classes=Array.from({length:8},(_,i)=>({id:insert('classes',{name:`${i+1} A`,teacher_id:staff[i],room:`${i<4?'A':'B'}-${101+i%4}`,capacity:35}),name:`${i+1} A`}));
  const students=[];
  for(let i=0;i<72;i++){
   const class_name=classes[Math.floor(i/9)].name,name=given[i%given.length]+' '+surnames[Math.floor(i/given.length)*2+i%2];
   const student=insert('customers',{name,email:`parent${i+1}@family.example`,phone:`980000${String(i+1).padStart(4,'0')}`,guardian:(i%2?'Neha ':'Rajesh ')+name.split(' ')[1],admission_no:`SDGS-${year}-${String(i+1).padStart(3,'0')}`,class_name,dob:`${year-6-Math.floor(i/9)}-${String(i%12+1).padStart(2,'0')}-${String(i%25+1).padStart(2,'0')}`,gender:i%2?'Female':'Male',address:`${101+i}, Demo Residency, Ghaziabad`,admitted_on:`${year}-04-01`,roll_no:String(i%9+1)});students.push({id:student,name,class_name});
   for(let n=0;n<14;n++){const attendanceDay=offset(-n);if(![0,6].includes(new Date(attendanceDay+'T12:00:00Z').getUTCDay()))db.prepare('INSERT INTO attendance VALUES(?,?,?)').run(student,attendanceDay,(i+n)%17===0?'Absent':(i+n)%29===0?'On leave':'Present');}
   for(let term=0;term<2;term++){
    const amount=(2500+Math.floor(i/9)*250)*100,invoice=insert('invoices',{student_id:student,purpose:term?'Term II tuition':'Term I tuition',amount,due_date:offset(term?14:-150+i%6*20),academic_year:`${year}–${String(year+1).slice(2)}`});
    const paid=term?(i%5===0?amount:0):(i%6===0?0:i%7===0?Math.floor(amount/2):amount);
    if(paid)insert('fees',{student_id:student,purpose:term?'Term II tuition':'Term I tuition',amount:paid,payment_date:offset(term?-(i%20):-(i%6)*30-i%12),method:['UPI','Cash','Bank transfer','Card'][i%4],invoice_id:invoice});
   }
  }
  for(let i=0;i<10;i++)insert('admissions',{name:given[(i+5)%18]+' '+surnames[i%8],guardian:'Demo Parent '+(i+1),phone:`970000${String(i+1).padStart(4,'0')}`,class_name:classes[i%8].name,status:['Inquiry','Interview','Accepted','Declined'][i%4],notes:'Fictional application for the new academic session.',applied_on:offset(-i)});
  classes.forEach((c,i)=>{
   for(let s=0;s<3;s++){
    const exam=insert('exams',{name:'Term I Assessment',class_name:c.name,subject:subjects[s],exam_date:offset(-14+s),max_marks:100,status:'Published'});
    students.filter(x=>x.class_name===c.name).forEach((student,j)=>insert('marks',{exam_id:exam,student_id:student.id,marks:54+(i*7+j*5+s*3)%46,remarks:j%4===0?'Consistent effort. Keep practising.':'Good progress.'}));
   }
   insert('exams',{name:'Monthly Assessment',class_name:c.name,subject:'Mathematics',exam_date:offset(10+i),max_marks:50,status:'Scheduled'});
   ['Monday','Tuesday','Wednesday','Thursday','Friday'].forEach((weekday,d)=>{
    for(let p=0;p<4;p++)insert('timetable',{class_name:c.name,day:weekday,start_time:`${String(8+p).padStart(2,'0')}:30`,end_time:`${String(9+p).padStart(2,'0')}:15`,subject:subjects[(i+p+d)%6],teacher_id:staff[(i+p)%8],room:`${i<4?'A':'B'}-${101+i%4}`});
   });
  });
  const titles=[['The Blue Umbrella','Ruskin Bond','Fiction'],['Malgudi Days','R. K. Narayan','Fiction'],['A Brief History of Time','Stephen Hawking','Science'],['Wings of Fire','A. P. J. Abdul Kalam','Biography'],['The Jungle Book','Rudyard Kipling','Fiction'],['Mathematics for Curious Minds','Demo Editorial Team','Mathematics'],['Our Beautiful Planet','Demo Editorial Team','Geography'],['Exploring Computers','Demo Editorial Team','Technology'],['Stories from India','Demo Editorial Team','History'],['The Science Explorer','Demo Editorial Team','Science'],['English Grammar Companion','Demo Editorial Team','Languages'],['Hindi Vyakaran','Demo Editorial Team','Languages']];
  titles.forEach(([title,author,category],i)=>{const book=insert('books',{isbn:'LIB-'+String(i+1).padStart(4,'0'),title,author,category,copies:4+i%4});if(i<9)insert('loans',{book_id:book,student_id:students[i*3].id,issued_on:offset(-10),due_on:offset(i<3?-2:5),returned_on:i===8?offset(-1):null});});
  const routes=[['North Campus Loop','UP 14 AB 1024','Rakesh Kumar','Raj Nagar\nKavi Nagar\nSchool Gate'],['City Centre Express','UP 14 CD 2078','Suresh Yadav','Indirapuram\nVasundhara\nSchool Gate'],['East Residential Loop','UP 14 EF 3190','Mahesh Pal','Crossings Republik\nShastri Nagar\nSchool Gate']];
  routes.forEach(([name,vehicle,driver,stops],i)=>{const route=insert('routes',{name,vehicle,driver,phone:'990000100'+i,capacity:30,stops,monthly_fee:(1200+i*200)*100});students.slice(i*16,i*16+16).forEach((student,j)=>insert('transport_assignments',{student_id:student.id,route_id:route,stop:stops.split('\n')[j%2]}));});
  const products=[['BOOK-5M','Class 5 mathematics book',15000,42],['UNI-S','School uniform · small',85000,18],['UNI-M','School uniform · medium',90000,7],['NOTE-A4','A4 ruled notebook',5500,120],['TIE','School tie',12000,8],['SPORT','Sports T-shirt',35000,24]];
  const productIds=products.map(([sku,name,price,stock])=>insert('products',{sku,name,price,stock}));
  for(let i=0;i<8;i++){const p=i%6,item=products[p],order=insert('orders',{customer_id:students[i].id,total:item[2]});insert('order_lines',{order_id:order,product_id:productIds[p],name:item[1],quantity:1,price:item[2]});db.prepare('UPDATE products SET stock=stock-1 WHERE id=?').run(productIds[p]);}
  for(let i=0;i<8;i++)insert('expenses',{category:['Utilities','Supplies','Maintenance','Transport'][i%4],payee:['Demo Power Services','Campus Stationery','School Maintenance Co.','Demo Fuel Station'][i%4],description:['Electricity bill','Classroom stationery','Facility maintenance','School bus fuel'][i%4],amount:[1850000,625000,940000,1240000][i%4],payment_date:offset(-i*3),method:'Bank transfer',reference:'DEMO-EXP-'+(i+1)});
  [['Parent–teacher meeting','The term review meeting is scheduled for next Saturday, 9 am to 12 pm. Class teachers should prepare individual progress notes.','All staff'],['Assessment planning','Please update the monthly assessment schedule and enter marks before publication.','Teachers'],['Fee collection review','Review overdue Term I invoices and record payments against the correct invoice.','Accounts staff'],['Annual sports day','House coordinators should submit participant lists to the sports department by Friday.','All staff']].forEach(([title,body,audience],i)=>insert('notices',{title,body,audience,published_on:offset(-i),expires_on:offset(21)}));
  insert('notices',{title:'Welcome to your school portal',body:'Check attendance, upcoming assessments, homework, and fee invoices. For corrections, contact the school office.',audience:'School community',published_on:day,expires_on:offset(60)});
  classes.forEach((c,i)=>{
   const homework=insert('homework',{class_name:c.name,subject:'Mathematics',title:'Fractions in everyday life',instructions:'Write three examples of fractions from your daily life. Explain how you would add two of these fractions, showing each step.',due_on:offset(5),max_marks:20});
   students.filter(s=>s.class_name===c.name).slice(0,3).forEach((s,j)=>insert('submissions',{homework_id:homework,student_id:s.id,answer:'Example 1: Half a glass of milk. Example 2: A quarter of an hour. Example 3: Three quarters of a pizza. One half plus one quarter equals three quarters.',score:j===0?18:null,feedback:j===0?'Clear examples and correct working.':''}));
   insert('homework',{class_name:c.name,subject:'English',title:'A letter to your future self',instructions:'Write a short letter about a skill you want to learn this year. Use complete sentences and check your punctuation.',due_on:offset(8),max_marks:25});
  });
  const previousMonth=new Date(day+'T12:00:00Z');previousMonth.setUTCDate(1);previousMonth.setUTCMonth(previousMonth.getUTCMonth()-1);
  staff.forEach((staffId,i)=>{const basic=(28000+i*1500)*100;insert('payroll',{staff_id:staffId,month:day.slice(0,7),basic,allowances:200000,deductions:150000});const oldMonth=previousMonth.toISOString().slice(0,7);insert('payroll',{staff_id:staffId,month:oldMonth,basic,allowances:200000,deductions:150000,status:'Paid',paid_on:offset(-25),method:'Bank transfer',reference:'DEMO-SAL-'+staffId});insert('expenses',{category:'Salaries',payee:teacherNames[i],description:'Salary for '+oldMonth,amount:basic+50000,payment_date:offset(-25),method:'Bank transfer',reference:'DEMO-SAL-'+staffId});});
  insert('leave_requests',{applicant_user:null,applicant_label:'Anjali Sharma',from_date:offset(3),to_date:offset(4),reason:'Fictional request: family commitment.',status:'Pending'});
  insert('leave_requests',{applicant_user:null,applicant_label:'Demo Parent',student_id:students[4].id,from_date:offset(1),to_date:offset(2),reason:'Fictional request: family event.',status:'Pending'});
  db.prepare("INSERT INTO settings(key,value) VALUES('demo_seed',?)").run(day);
  insert('school_events',{action:'loaded',entity:'demo',detail:'72 fictional students, 12 staff, 8 classes, and sample school workflows.'});
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
