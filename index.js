const express = require("express");
const bodyparser = require("body-parser");
const mysql = require("mysql2/promise");
const redis = require("redis");
const cron = require("node-cron");

const app = express();

app.use(bodyparser.json());

const port = 8000;

let conn = null;
let redisConn = null;

// function init connection mysql
const initMySQL = async () => {
  conn = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "root",
    database: "tutorial",
  });
};

// function init connection redis
const initRedis = async () => {
  redisConn = redis.createClient();
  redisConn.on("error", (err) => console.log("Redis Client Error", err));
  await redisConn.connect();
};

// lazy loading
app.get("/users", async (req, res) => {
  const cachedData = await redisConn.get("users");

  if (cachedData) {
    const results = JSON.parse(cachedData) //ตอนดึงข้อมูลจาก cache ออกมาและแปลงกลับเป็น object ใช้ JSON.parse
    res.json(results);
    return;
  } 
  
    const results = await conn.query("SELECT * FROM users");
    const userStringData = JSON.stringify(results[0]); //redis จะเก็บข้อมูลเป็น string เลยใช้ JSON.stringify เพื่อแปลงข้อมูลเป็น string
    await redisConn.set("users", userStringData);

    res.json(results[0]);
  }
);

// write through 
app.get("/users/cache-2", async (req, res) => {
  const cachedData = await redisConn.get("users-2");

  if (cachedData) {
    const results = JSON.parse(cachedData) //ตอนดึงข้อมูลจาก cache ออกมาและแปลงกลับเป็น object ใช้ JSON.parse
    res.json(results);
    return;
  } 
  
    const results = await conn.query("SELECT * FROM users");
    res.json(results[0]);
  }
);

// write through
app.post("/users", async (req, res) => {
  let user = req.body;
  const [results] = await conn.query('INSERT INTO users SET ?', user);
  const cachedData = await redisConn.get("users-2");
  user.id = results.insertId;

  if (cachedData) {
    //อัพเดทจาก cache
    let usersData = JSON.parse(cachedData)
    usersData.push(user) // push user ที่รับจาก body เข้าไปใน array usersData เพื่ออัพเดทข้อมูล
    await redisConn.set("users-2", JSON.stringify(usersData)); 
    return;
  } else {
    // ดึงจาก database มาทำ cache ใหม่ก่อน
    const results = await conn.query("SELECT * FROM users");
    await redisConn.set("users-2", JSON.stringify(results[0]));
  }


  res.json({
    message: "User created successfully",
    results: results
  })
});

// write back
app.get("/users/cache-3", async (req, res) => {
  const cachedData = await redisConn.get("users-3");

  if (cachedData) {
    const results = JSON.parse(cachedData) //ตอนดึงข้อมูลจาก cache ออกมาและแปลงกลับเป็น object ใช้ JSON.parse
    res.json(results);
    return;
  } 
  
    const results = await conn.query("SELECT * FROM users");
    res.json(results[0]);
  }
);

app.put("/users/:id", async (req, res) => {
  let user = req.body;
  let id = parseInt(req.params.id);
  user.id = id;

  const cachedData = await redisConn.get("users-3");
  let userUpdateIndex = await redisConn.get('user-update-index') || [];

  if (cachedData) {
    //อัพเดทจาก cache
    const results = JSON.parse(cachedData);
    const selectedIndex = results.findIndex(user => user.id === id);
    results[selectedIndex] = user;
    userUpdateIndex.push(selectedIndex);
    await redisConn.set("users-3", JSON.stringify(results));

  } else {
    // ดึงจาก database มาทำ cache ใหม่ก่อน
    const results = await conn.query("SELECT * FROM users");
    const selectedIndex = results[0].findIndex(user => user.id === id);
    results[0][selectedIndex] = user;
    userUpdateIndex.push(selectedIndex);
    await redisConn.set("users-3", JSON.stringify(results[0]));
  }
  await redisConn.set('user-update-index', JSON.stringify(userUpdateIndex));

  res.json({
    message: "User updated successfully",
    user
  })
});

cron.schedule('*/5  * * * * *', async () => {
  try {
    const cachedDataString = await redisConn.get("users-3");
    const userUpdateIndexString = await redisConn.get('user-update-index');

    // Check if we have valid data before parsing
    if (!cachedDataString || !userUpdateIndexString) {
      return;
    }

    const cachedData = JSON.parse(cachedDataString);
    const userUpdateIndex = JSON.parse(userUpdateIndexString);

    // Check if userUpdateIndex is an array and has items
    if (Array.isArray(userUpdateIndex) && userUpdateIndex.length > 0) {
      for (let i = 0; i < userUpdateIndex.length; i++) {
        const id = cachedData[userUpdateIndex[i]].id; // userUpdateIndex จะเป็น index ของ user ที่อัพเดท โดย cachedData เป็นเจ้าของข้อมูลนั้นที่จะอัพเดท
        const updateUser = {
          name: cachedData[userUpdateIndex[i]].name,
          age: cachedData[userUpdateIndex[i]].age,
          description: cachedData[userUpdateIndex[i]].description
        }
        const [results] = await conn.query(
          'UPDATE users SET ? WHERE id = ?',
          [updateUser, id]
        );
      }
      console.log('userUpdate', results);
    }
    await redisConn.del('user-update-index');
  } catch (error) {
    console.error('Error in cron job:', error);
  }
});



app.listen(port, async (req, res) => {
  await initMySQL();
  await initRedis();
  console.log("http server run at " + port);
});