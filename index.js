const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).json({ message: "Unathorized access" });
  }
  // bearer & token
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.SECRET_ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Unathorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.phpiexj.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const menuCollection = client.db("foodPagolDB").collection("menu");
    const cartCollection = client.db("foodPagolDB").collection("carts");
    const userCollection = client.db("foodPagolDB").collection("users");
    const paymentCollection = client.db("foodPagolDB").collection("payments");
    const reviewCollection = client.db("foodPagolDB").collection("reviews");

    // JWT
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.SECRET_ACCESS_TOKEN, { expiresIn: "7d" });
      res.send(token);
    });

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;

      const user = await userCollection.findOne({ email: email });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (user.role !== "admin") {
        return res.status(403).json({ message: "forbidden access" });
      }
      next();
    };

    /**
     * Menu item
     */
    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const result = await menuCollection.findOne({ _id: id });
      res.status(200).send(result);
    });

    app.put("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const updateItem = req.body;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const UpdatedItem = {
        $set: {
          category: updateItem.category,
          image: updateItem.image,
          name: updateItem.name,
          price: updateItem.price,
          recipe: updateItem.recipe,
        },
      };
      const result = await menuCollection.updateOne(filter, UpdatedItem, options);
      res.send(result);
    });

    app.delete("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await menuCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // All menu collection
    app.get("/menu", async (_req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post("/menu", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await menuCollection.insertOne(req.body);
      res.send(result);
    });

    /**
     * User handle
     */

    // get admin
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        return res.send({ message: "Forbidden access" });
      }

      const user = await userCollection.findOne({ email: email });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const admin = { admin: user.role === "admin" };
      res.status(200).send(admin);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.get("/users", verifyJWT, verifyAdmin, async (_req, res) => {
      const result = await userCollection.find().toArray();
      res.status(200).send(result);
    });

    // User data api
    app.post("/users", async (req, res) => {
      const query = { email: req.body.email };

      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.status(400).send({ message: "User already exits" });
      }
      const result = await userCollection.insertOne(req.body);
      res.status(200).send(result);
    });

    /**
     * Cart handle
     */

    app.delete("/carts/:id", async (req, res) => {
      const { id } = req.params;
      const result = await cartCollection.deleteOne({ _id: new ObjectId(id) });
      res.status(203).send(result);
    });

    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (decodedEmail !== email) {
        return res.status(403).send({ error: true, message: "forbidden access" });
      }

      const result = await cartCollection.find({ email: email }).toArray();
      res.status(200).send(result);
    });

    app.post("/carts", async (req, res) => {
      const result = await cartCollection.insertOne(req.body);
      res.status(200).send(result);
    });

    /**
     *Payment handle
     */
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/payments/:id", async (req, res) => {
      const { id } = req.params;

      const result = await paymentCollection.findOne({ _id: new ObjectId(id) });
      res.status(200).send(result);
    });

    app.get("/payments", verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(404).json({ message: "User not found" });
      }
      const decodedEmail = req.decoded.email;
      if (decodedEmail !== email) {
        return res.status(403).json({ message: "forbidden access" });
      }
      const result = await paymentCollection.find({ email: email }).toArray();
      res.status(200).send(result);
    });

    // Create payment history api
    app.post("/payments", verifyJWT, async (req, res) => {
      const payment = req.body;

      const insertedResult = await paymentCollection.insertOne(payment);

      const query = { _id: { $in: payment.cartItems.map((id) => new ObjectId(id)) } };

      const deletedCount = await cartCollection.deleteMany(query);
      res.status(200).send({ insertedResult, deletedCount });
    });

    app.get("/orders/state", verifyJWT, verifyAdmin, async (_req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: "menu",
            localField: "menuItems",
            foreignField: "_id",
            as: "menuItemsData",
          },
        },
        {
          $unwind: "$menuItemsData",
        },
        {
          $group: {
            _id: "$menuItemsData.category",
            numberOfItems: { $sum: 1 },
            price: { $sum: "$menuItemsData.price" },
          },
        },
        {
          $project: {
            _id: 0,
            category: "$_id",
            numberOfItems: 1,
            totalPrice: { $round: ["$price", 2] },
          },
        },
      ];
      const result = await paymentCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    /**
     * Review
     */
    app.get("/reviews", async (_req, res) => {
      const result = await reviewCollection.find().toArray();
      res.status(200).send(result);
    });

    app.post("/reviews", verifyJWT, async (req, res) => {
      const id = req.body.paymentId;
      const { email } = req.query;
      if (!email) {
        return res.status(404).json({ message: "User not found" });
      }

      if (req.decoded.email !== email) {
        return res.status(403).json({ message: "forbidden access" });
      }

      const existReview = await reviewCollection.findOne({ paymentId: id });
      console.log(existReview);

      if (existReview) {
        res.status(400).json({ message: "Already done!" });
      } else {
        const result = await reviewCollection.insertOne(req.body);
        res.status(200).json(result);
      }
    });

    app.get("/admin-state", async (_req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      const revenue = await paymentCollection
        .aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: "$price" },
            },
          },
        ])
        .toArray();
      res.send({
        users,
        products,
        orders,
        revenue,
      });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Your project successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (_req, res) => {
  res.send("Food Pagol server is running");
});

app.listen(port, () => {
  console.log(`Food pagol server running on port: ${port}`);
});
