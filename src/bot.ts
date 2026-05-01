import { Telegraf, Scenes, session, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import { Student, initDB } from './database';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';

dotenv.config();

const token = process.env.BOT_TOKEN;
const adminId = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;
const port = process.env.PORT || 3000;
const domain = process.env.RAILWAY_PUBLIC_DOMAIN || ''; // Railway provides this

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

// Express setup for Mini App
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API Security Middleware
const isAdmin = (req: express.Request) => {
  const initData = req.headers['x-tg-init-data'] as string;
  if (!initData) return false;
  
  try {
    const urlParams = new URLSearchParams(initData);
    const user = JSON.parse(urlParams.get('user') || '{}');
    return user.id === adminId;
  } catch (e) {
    return false;
  }
};

app.get('/api/students', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Unauthorized' });
  
  try {
    const students = await Student.findAll({ order: [['createdAt', 'DESC']] });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/students/clear-all', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Unauthorized' });

  try {
    await Student.destroy({ where: {}, truncate: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Registration Scene
const registrationScene = new Scenes.WizardScene<MyContext>(
  'registration_wizard',
  async (ctx) => {
    await ctx.reply('👤 Ism va familiyangizni kiriting:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message && 'text' in ctx.message) {
      const state = ctx.wizard.state as MySceneSession;
      state.fullName = ctx.message.text;
      await ctx.reply(
        '📚 Sinfingizni tanlang:',
        Markup.inlineKeyboard([
          [Markup.button.callback('1-sinf', 'grade_1'), Markup.button.callback('2-sinf', 'grade_2')],
          [Markup.button.callback('3-sinf', 'grade_3'), Markup.button.callback('4-sinf', 'grade_4')],
          [Markup.button.callback('5-sinf', 'grade_5'), Markup.button.callback('6-sinf', 'grade_6')],
          [Markup.button.callback('7-sinf', 'grade_7'), Markup.button.callback('8-sinf', 'grade_8')],
        ])
      );
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
      const grade = parseInt(ctx.callbackQuery.data.split('_')[1] || '0');
      const state = ctx.wizard.state as MySceneSession;
      state.grade = grade;
      await ctx.answerCbQuery();
      await ctx.editMessageText(`✅ Tanlangan sinf: ${grade}\n\n🏫 Maktabingiz nomini kiriting:`);
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    if (ctx.message && 'text' in ctx.message) {
      const state = ctx.wizard.state as MySceneSession;
      state.school = ctx.message.text;
      await ctx.reply('📞 Telefon raqamingizni kiriting (masalan: +998901234567):', Markup.keyboard([
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

      await ctx.reply('✅ Siz muvaffaqiyatli ro‘yxatdan o‘tdingiz! Admin to‘lovingizni tasdiqlaganidan so‘ng sizga xabar yuboramiz.');

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

// Allow global commands and actions during registration
registrationScene.command('start', async (ctx) => {
    await ctx.scene.leave();
    const startText = `🏆 MATEMATIKA OLIMPIADA \n\n📍 Hudud: Shofirkon tumani\n🏫 Joy: IDROK School xususiy maktabi\n📅 Sana: 10-may\n⏰ Vaqt: 08:30\n\nOlimpiada 1–8-sinf o‘quvchilari uchun tashkil etiladi.\nHar bir sinf o‘quvchilari alohida bellashadi.\n\n💰 Ro‘yxatdan o‘tish narxi: 50 000 so‘m\n\nPastdagi tugmalar orqali kerakli bo'limni tanlang.`;
    if (ctx.from?.id === adminId) {
        const cleanDomain = domain.replace(/^https?:\/\//, '');
        const webapp_url = `https://${cleanDomain}`;
        await ctx.reply(startText, adminMenu(webapp_url));
    } else {
        await ctx.reply(startText, mainMenu);
    }
});

registrationScene.action('info', async (ctx) => {
    await ctx.scene.leave();
    await ctx.answerCbQuery();
    await ctx.reply(`🏆 MATEMATIKA OLIMPIADA \n\n📍 Hudud: Shofirkon tumani\n🏫 Joy: IDROK School xususiy maktabi\n📅 Sana: 10-may\n⏰ Vaqt: 08:30\n\nOlimpiada 1–8-sinf o‘quvchilari uchun tashkil etiladi.\nHar bir sinf o‘quvchilari alohida bellashadi.`, mainMenu);
});

registrationScene.action('payment', async (ctx) => {
    await ctx.scene.leave();
    await ctx.answerCbQuery();
    await ctx.reply(`💳 Ro‘yxatdan o‘tish to‘lovi: 50 000 so‘m\n\nKarta raqami:\n5614 6887 0489 8500\n\nKarta egasi:\nUbaydullayev Muhammadali`, mainMenu);
});

registrationScene.action('contact', async (ctx) => {
    await ctx.scene.leave();
    await ctx.answerCbQuery();
    await ctx.reply(`📞 Savollaringiz bo'lsa, @Umidov_008 ga murojaat qiling.`, mainMenu);
});

const stage = new Scenes.Stage<MyContext>([registrationScene]);
bot.use(session());
bot.use(stage.middleware());

// Main Menu Inline Keyboard
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('📋 Ro‘yxatdan o‘tish', 'start_reg')],
  [Markup.button.callback('ℹ️ Olimpiada haqida', 'info'), Markup.button.callback('💳 To‘lov ma’lumotlari', 'payment')],
  [Markup.button.callback('📞 Admin bilan aloqa', 'contact')],
]);

const adminMenu = (webapp_url: string) => Markup.inlineKeyboard([
    [Markup.button.webApp('📊 Admin Panel (Mini App)', webapp_url)],
    [Markup.button.callback('📋 Ro‘yxatdan o‘tish', 'start_reg')],
    [Markup.button.callback('📉 Excel Export', 'export_data')],
]);

// Commands
bot.start(async (ctx) => {
  const startText = `🏆 MATEMATIKA OLIMPIADA \n\n📍 Hudud: Shofirkon tumani\n🏫 Joy: IDROK School xususiy maktabi\n📅 Sana: 10-may\n⏰ Vaqt: 08:30\n\nOlimpiada 1–8-sinf o‘quvchilari uchun tashkil etiladi.\nHar bir sinf o‘quvchilari alohida bellashadi.\n\n💰 Ro‘yxatdan o‘tish narxi: 50 000 so‘m\n\nPastdagi tugmalar orqali kerakli bo'limni tanlang.`;
  
  if (ctx.from?.id === adminId) {
    if (domain) {
      // Ensure domain has https:// and no double protocol
      const cleanDomain = domain.replace(/^https?:\/\//, '');
      const webapp_url = `https://${cleanDomain}`;
      await ctx.reply(startText, adminMenu(webapp_url));
    } else {
      // Fallback if domain is not set
      await ctx.reply(startText + '\n\n⚠️ Eslatma: RAILWAY_PUBLIC_DOMAIN o\'rnatilmagan, Admin Panel ishlamasligi mumkin.', adminMenu('https://railway.app'));
    }
  } else {
    await ctx.reply(startText, mainMenu);
  }
});

bot.action('start_reg', async (ctx) => {
  const student = await Student.findOne({ where: { telegramId: ctx.from?.id } });
  if (student) {
    let statusEmoji = '⏳';
    let statusText = 'Kutilmoqda';
    if (student.paymentStatus === 'approved') {
        statusEmoji = '✅';
        statusText = 'Tasdiqlangan';
    } else if (student.paymentStatus === 'rejected') {
        statusEmoji = '❌';
        statusText = 'Rad etilgan';
    }

    await ctx.answerCbQuery();
    await ctx.reply(`Siz allaqachon ro‘yxatdan o‘tgansiz!\n\n📋 Ism: ${student.fullName}\n${statusEmoji} Holat: ${statusText}`);
    return;
  }
  return ctx.scene.enter('registration_wizard');
});
bot.action('info', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`🏆 MATEMATIKA OLIMPIADA \n\n📍 Hudud: Shofirkon tumani\n🏫 Joy: IDROK School xususiy maktabi\n📅 Sana: 10-may\n⏰ Vaqt: 08:30\n\nOlimpiada 1–8-sinf o‘quvchilari uchun tashkil etiladi.\nHar bir sinf o‘quvchilari alohida bellashadi.`, mainMenu);
});

bot.action('payment', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`💳 Ro‘yxatdan o‘tish to‘lovi: 50 000 so‘m\n\nKarta raqami:\n5614 6887 0489 8500\n\nKarta egasi:\nUbaydullayev Muhammadali`, mainMenu);
});

bot.action('contact', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`📞 Savollaringiz bo'lsa, @Umidov_008 ga murojaat qiling.`, mainMenu);
});

bot.action('export_data', async (ctx) => {
    if (ctx.from?.id !== adminId) return;
    await ctx.answerCbQuery('Eksport qilinmoqda...');
    
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

// Admin Actions for Approval
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
    
    await bot.telegram.sendMessage(student.telegramId, '✅ To‘lovingiz tasdiqlandi. Siz muvaffaqiyatli ro‘yxatdan o‘tdingiz!');
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
    
    await bot.telegram.sendMessage(student.telegramId, '❌ Chekingiz tasdiqlanmadi. Iltimos, to‘g‘ri chek yuboring va qayta ro‘yxatdan o‘ting.');
  }
});

initDB().then(() => {
  bot.launch();
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
  console.log('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
