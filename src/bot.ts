import { Telegraf, Scenes, session, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import { Student, initDB } from './database';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

dotenv.config();

const token = process.env.BOT_TOKEN;
const adminId = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

if (!token) {
  console.error('BOT_TOKEN is not defined in .env file');
  process.exit(1);
}

interface MySceneSession extends Scenes.WizardSessionData {
  fullName: string;
  grade: number;
  school: string;
  phone: string;
}

type MyContext = Scenes.WizardContext<MySceneSession>;

const bot = new Telegraf<MyContext>(token);

// Registration Scene
const registrationScene = new Scenes.WizardScene<MyContext>(
  'registration_wizard',
  async (ctx) => {
    await ctx.reply('Ism va familiyangizni kiriting:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message && 'text' in ctx.message) {
      const state = ctx.wizard.state as MySceneSession;
      state.fullName = ctx.message.text;
      await ctx.reply(
        'Sinfingizni tanlang:',
        Markup.keyboard([
          ['1-sinf', '2-sinf', '3-sinf', '4-sinf'],
          ['5-sinf', '6-sinf', '7-sinf', '8-sinf'],
        ]).oneTime().resize()
      );
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    if (ctx.message && 'text' in ctx.message) {
      const grade = parseInt(ctx.message.text);
      if (isNaN(grade) || grade < 1 || grade > 8) {
        await ctx.reply('Iltimos, tugmalardan birini tanlang (1-8 sinf).');
        return;
      }
      const state = ctx.wizard.state as MySceneSession;
      state.grade = grade;
      await ctx.reply('Maktabingiz nomini kiriting:');
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    if (ctx.message && 'text' in ctx.message) {
      const state = ctx.wizard.state as MySceneSession;
      state.school = ctx.message.text;
      await ctx.reply('Telefon raqamingizni kiriting (masalan: +998901234567):', Markup.keyboard([
        [Markup.button.contactRequest('📞 Telefon raqamni yuborish')]
      ]).oneTime().resize());
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    let phone = '';
    if (ctx.message && 'contact' in ctx.message) {
      phone = ctx.message.contact.phone_number;
    } else if (ctx.message && 'text' in ctx.message) {
      phone = ctx.message.text;
    }

    if (phone) {
      const state = ctx.wizard.state as MySceneSession;
      state.phone = phone;
      await ctx.reply(
        `💳 Ro‘yxatdan o‘tish to‘lovi: 50 000 so‘m\n\nKarta raqami:\n5614 6887 0489 8500\n\nKarta egasi:\nUbaydullayev Muhammadali\n\nTo‘lov qilgandan so‘ng chek rasmini yoki PDF faylni shu botga yuboring.`,
        Markup.removeKeyboard()
      );
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    let fileId = '';
    if (ctx.message && 'photo' in ctx.message && ctx.message.photo) {
      const photos = ctx.message.photo;
      fileId = photos[photos.length - 1]?.file_id || '';
    } else if (ctx.message && 'document' in ctx.message && ctx.message.document) {
      fileId = ctx.message.document.file_id;
    }

    if (fileId && ctx.from) {
      const state = ctx.wizard.state as MySceneSession;
      
      // Save to DB
      const student = await Student.create({
        telegramId: ctx.from.id,
        fullName: state.fullName,
        grade: state.grade,
        school: state.school,
        phone: state.phone,
        receiptFileId: fileId,
        paymentStatus: 'pending',
      });

      await ctx.reply('✅ Chekingiz qabul qilindi. Admin tasdiqlashini kuting.');

      // Notify Admin
      if (adminId) {
        const adminMsg = `🆕 Yangi qatnashchi:\n\n👤 Ism: ${state.fullName}\n📚 Sinf: ${state.grade}\n🏫 Maktab: ${state.school}\n📞 Tel: ${state.phone}\n\nTo'lov holati: Kutilmoqda`;
        
        await ctx.telegram.sendPhoto(adminId, fileId, {
            caption: adminMsg,
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Tasdiqlash', `approve_${student.id}`)],
                [Markup.button.callback('❌ Rad etish', `reject_${student.id}`)]
            ])
        }).catch(async () => {
             // If file is a document
             await ctx.telegram.sendDocument(adminId, fileId, {
                caption: adminMsg,
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Tasdiqlash', `approve_${student.id}`)],
                    [Markup.button.callback('❌ Rad etish', `reject_${student.id}`)]
                ])
            });
        });
      }

      return ctx.scene.leave();
    } else {
        await ctx.reply('Iltimos, to‘lov cheki rasmini yoki PDF faylini yuboring.');
    }
  }
);

const stage = new Scenes.Stage<MyContext>([registrationScene]);
bot.use(session());
bot.use(stage.middleware());

// Commands
bot.start(async (ctx) => {
  const startText = `🏆 MATEMATIKA OLIMPIADA \n\n📍 Hudud: Shofirkon tumani\n🏫 Joy: IDROK School xususiy maktabi\n📅 Sana: 10-may\n⏰ Vaqt: 08:30\n\nOlimpiada 1–8-sinf o‘quvchilari uchun tashkil etiladi.\nHar bir sinf o‘quvchilari alohida bellashadi.\n\n💰 Ro‘yxatdan o‘tish narxi: 50 000 so‘m\n\nRo‘yxatdan o‘tish uchun pastdagi tugmani bosing.`;
  
  await ctx.reply(startText, Markup.keyboard([
    ['📋 Ro‘yxatdan o‘tish'],
    ['ℹ️ Olimpiada haqida', '💳 To‘lov ma’lumotlari'],
    ['📞 Admin bilan aloqa']
  ]).resize());
});

bot.hears('📋 Ro‘yxatdan o‘tish', (ctx) => ctx.scene.enter('registration_wizard'));

bot.hears('ℹ️ Olimpiada haqida', async (ctx) => {
  await ctx.reply(`🏆 MATEMATIKA OLIMPIADA \n\n📍 Hudud: Shofirkon tumani\n🏫 Joy: IDROK School xususiy maktabi\n📅 Sana: 10-may\n⏰ Vaqt: 08:30\n\nOlimpiada 1–8-sinf o‘quvchilari uchun tashkil etiladi.\nHar bir sinf o‘quvchilari alohida bellashadi.`);
});

bot.hears('💳 To‘lov ma’lumotlari', async (ctx) => {
  await ctx.reply(`💳 Ro‘yxatdan o‘tish to‘lovi: 50 000 so‘m\n\nKarta raqami:\n5614 6887 0489 8500\n\nKarta egasi:\nUbaydullayev Muhammadali`);
});

bot.hears('📞 Admin bilan aloqa', async (ctx) => {
  await ctx.reply(`📞 Savollaringiz bo'lsa, @admin_user ga murojaat qiling.`);
});

// Admin Actions
bot.action(/approve_(\d+)/, async (ctx) => {
  const match = ctx.match as RegExpExecArray;
  const id = parseInt(match[1] || '0');
  const student = await Student.findByPk(id);
  if (student) {
    student.paymentStatus = 'approved';
    await student.save();
    await ctx.answerCbQuery('Tasdiqlandi');
    const message = ctx.callbackQuery?.message;
    const caption = message && 'caption' in message ? (message as any).caption : '';
    await ctx.editMessageCaption((caption || '') + '\n\n✅ HOLAT: TASDIQLANDI');
    
    await bot.telegram.sendMessage(student.telegramId, '✅ To‘lovingiz tasdiqlandi. Siz ro‘yxatdan o‘tdingiz.');
  }
});

bot.action(/reject_(\d+)/, async (ctx) => {
  const match = ctx.match as RegExpExecArray;
  const id = parseInt(match[1] || '0');
  const student = await Student.findByPk(id);
  if (student) {
    student.paymentStatus = 'rejected';
    await student.save();
    await ctx.answerCbQuery('Rad etildi');
    const message = ctx.callbackQuery?.message;
    const caption = message && 'caption' in message ? (message as any).caption : '';
    await ctx.editMessageCaption((caption || '') + '\n\n❌ HOLAT: RAD ETILDI');
    
    await bot.telegram.sendMessage(student.telegramId, '❌ Chekingiz tasdiqlanmadi. Iltimos, to‘g‘ri chek yuboring.');
  }
});

// Admin Commands
bot.command('stats', async (ctx) => {
  if (ctx.from?.id !== adminId) return;

  const total = await Student.count();
  const approved = await Student.count({ where: { paymentStatus: 'approved' } });
  const pending = await Student.count({ where: { paymentStatus: 'pending' } });
  
  let gradeStats = '';
  for (let i = 1; i <= 8; i++) {
    const count = await Student.count({ where: { grade: i, paymentStatus: 'approved' } });
    gradeStats += `\n${i}-sinf: ${count} ta`;
  }

  await ctx.reply(`📊 Statistika:\n\nJami ro'yxatdan o'tganlar: ${total}\n✅ To'lov tasdiqlangan: ${approved}\n⏳ To'lov kutilmoqda: ${pending}\n\nSinflar bo'yicha (tasdiqlanganlar):${gradeStats}`);
});

bot.command('export', async (ctx) => {
  if (ctx.from?.id !== adminId) return;

  const students = await Student.findAll();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');

  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Telegram ID', key: 'telegramId', width: 15 },
    { header: 'Ism Familiya', key: 'fullName', width: 30 },
    { header: 'Sinf', key: 'grade', width: 10 },
    { header: 'Maktab', key: 'school', width: 30 },
    { header: 'Telefon', key: 'phone', width: 20 },
    { header: 'Holat', key: 'paymentStatus', width: 15 },
    { header: 'Sana', key: 'createdAt', width: 20 },
  ];

  students.forEach(s => worksheet.addRow(s.toJSON()));

  const buffer = await workbook.xlsx.writeBuffer();
  const filePath = path.join(__dirname, '..', 'students.xlsx');
  fs.writeFileSync(filePath, Buffer.from(buffer));

  await ctx.replyWithDocument({ source: filePath, filename: 'students.xlsx' });
});

initDB().then(() => {
  bot.launch();
  console.log('Bot started');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
