const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decodedKey);


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster.fhxucjr.mongodb.net/?appName=Cluster`;

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
    // await client.connect();

    const db = client.db("addCampDB");
    const usersCollection = db.collection("users");
    const addCampsCollection = db.collection("addCamps");
    const paymentsCollection = db.collection("payments");
    const participantCollection = db.collection("participants");
    const feedbacksCollection = db.collection("feedbacks");

    // -------Custom Middelware---------------

    const verifyFBToken = async (req, res, next) => {
      console.log("header in middleware", req.headers);
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      // verify the token

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    const verifyOrganizer = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "organizer") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // !-----------------------------------------Camp Data API----------------------------------------------------
    // -----------------Get data addCamps-----------------
    app.get("/addCamps/all", async (req, res) => {
      try {
        const camps = await addCampsCollection
          .find()
          .sort({ creation_date: -1 })
          .toArray(); // Sorting by latest first
        res.status(200).json(camps); // Sending the camps array in response
      } catch (err) {
        console.error("Error fetching camps:", err);
        res.status(500).json({ error: "Failed to fetch camps" });
      }
    });

    // --------------Camp Details Id----------------

    app.get("/camp-details/:campId", async (req, res) => {
      const { campId } = req.params;

      if (!ObjectId.isValid(campId)) {
        return res.status(400).send({ message: "Invalid Camp ID" });
      }

      const camp = await addCampsCollection.findOne({
        _id: new ObjectId(campId),
      });

      res.send(camp);
    });

    // GET camps (all or by organizerEmail) — sorted latest first
    app.get("/addCamps/token", async (req, res) => {
      try {
        const userEmail = req.query.email;

        const query = userEmail ? { organizerEmail: userEmail } : {};

        const camps = await addCampsCollection
          .find(query)
          .sort({ creation_date: -1 })
          .toArray();

        //       {$set: {
        // participantCount: { $size: "$participants" }}}

        res.send(camps);
      } catch (err) {
        console.error("Error fetching camps:", err);
        res.status(500).send({ error: "Failed to fetch camps" });
      }
    });

    // ----Add Camps Post---------

    app.post("/addCamps", async (req, res) => {
      try {
        const newCamp = req.body;
        const result = await addCampsCollection.insertOne(newCamp);
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to add camp" });
      }
    });

    // !---------------------------------FeedBack API----------------------------------

    // ----------------------Get Feedback API-----------------------
    app.get("/feedbacks", async (req, res) => {
      try {
        const feedbacks = await feedbacksCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        res.send(feedbacks);
      } catch (error) {
        console.error("Fetch feedbacks error:", error);
        res.status(500).send({ message: "Failed to load feedbacks" });
      }
    });

    // ----------------------Post Feedback API----------------------
    app.post("/feedbacks", async (req, res) => {
      try {
        const {
          participantId,
          participantName,
          participantEmail,
          campId,
          campName,
          rating,
          feedback,
        } = req.body;

        if (!rating || !feedback) {
          return res
            .status(400)
            .send({ message: "Rating and feedback required" });
        }

        const feedbackDoc = {
          participantId: new ObjectId(participantId),
          participantName,
          participantEmail,
          campId: new ObjectId(campId),
          campName,
          rating: Number(rating),
          feedback,
          createdAt: new Date(),
        };

        const result = await feedbacksCollection.insertOne(feedbackDoc);

        res.send({
          success: true,
          message: "Feedback submitted successfully",
          feedbackId: result.insertedId,
        });
      } catch (error) {
        console.error("Feedback error:", error);
        res.status(500).send({ message: "Failed to submit feedback" });
      }
    });

    // --------------------------------Feedback Card---------------------
    // Get all feedbacks (or filter by participantEmail if needed)
    app.get("/feedbacks", async (req, res) => {
      try {
        const { participantEmail } = req.query; // optional
        const query = participantEmail ? { participantEmail } : {};
        const feedbacks = await feedbacksCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(feedbacks);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // -----------------------Feedback Verified----------------------------
    app.get("/feedbacks/verified", async (req, res) => {
      const feedbacks = await feedbacksCollection
        .find({
          paymentStatus: "paid",
          confirmationStatus: "confirmed",
        })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(feedbacks);
    });

    // -------------------Impact Status------------------------------------
    app.get("/stats/impact", async (req, res) => {
      const participants = await participantCollection.countDocuments({
        paymentStatus: "paid",
        confirmationStatus: "confirmed",
      });

      const camps = await addCampsCollection.countDocuments();

      const feedbacks = await feedbacksCollection.countDocuments();

      const avg = await feedbacksCollection
        .aggregate([{ $group: { _id: null, rating: { $avg: "$rating" } } }])
        .toArray();

      res.send({
        participants,
        camps,
        feedbacks,
        rating: avg[0]?.rating?.toFixed(1) || 0,
      });
    });

    // !-----------------------------Organizer API------------------------

    // -----------------Organizer Profile API---------------------
    app.get("/organizerProfile/:email", async (req, res) => {
      const { email } = req.params;

      if (!email) {
        return res.status(400).send({ message: "Email required" });
      }

      try {
        const organizer = await participantCollection.findOne({
          organizerEmail: email,
        });

        // If profile doesn't exist yet, return default structure
        if (!organizer) {
          return res.send({
            organizerName: "",
            organizerEmail: email,
            phone: "",
            photoURL: "",
            bio: "",
            totalCamps: 0,
          });
        }

        res.send(organizer);
      } catch (error) {
        console.error("Organizer fetch error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // -----------------Organizer Profile Update API---------------------

    app.put("/organizerProfile/update/:email", async (req, res) => {
      const { email } = req.params;
      const updatedData = req.body;

      if (!email) {
        return res.status(400).send({ message: "Email required" });
      }

      try {
        const updateDoc = {
          $set: {
            organizerName: updatedData.name || updatedData.organizerName,
            organizerEmail: email,
            phone: updatedData.phone || "",
            photoURL: updatedData.photoURL || "",
            bio: updatedData.bio || "",
          },
        };

        const result = await participantCollection.updateOne(
          { organizerEmail: email },
          updateDoc,
          { upsert: true }
        );

        res.send(result);
      } catch (error) {
        console.error("Organizer update error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // --------Camp Update API----------

    app.get("/orgDashboard/camp/:campId", async (req, res) => {
      const campId = req.params.campId;

      const camp = await addCampsCollection.findOne({
        _id: new ObjectId(campId),
      });

      res.send(camp);
    });

    app.put("/orgDashboard/update-camp/:campId", async (req, res) => {
      const campId = req.params.campId;
      const body = req.body;

      const updatedCamp = {
        campName: body.campName,
        image: body.image,
        dateTime: body.dateTime,
        location: body.location,
        healthcareProfessional: body.healthcareProfessional,
      };

      try {
        const result = await addCampsCollection.updateOne(
          { _id: new ObjectId(campId) },
          { $set: updatedCamp }
        );

        res.send(result);
      } catch (error) {
        console.log("UPDATE ERROR:", error);
        res.status(500).send({ error: "Update failed" });
      }
    });

    // ---Camp Delete API----------------
    app.delete("/delete-camp/:campId", async (req, res) => {
      try {
        const campId = req.params.campId;

        const result = await addCampsCollection.deleteOne({
          _id: new ObjectId(campId),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ error: "Camp not found" });
        }

        res.send({ success: true, message: "Camp deleted successfully" });
      } catch (err) {
        console.error("Error deleting camp:", err);
        res.status(500).send({ error: "Failed to delete camp" });
      }
    });

    // !-----------------------------------------------User API----------------------------------------------------
    // -------Post for users------------

    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        // update last log in
        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // ----------------------GET user role by email---------------
    app.get("/users/role/:email", async (req, res) => {
      try {
        const email = req.params.email;

        // Security check: user can only request their own role
        if (!email) {
          return res.status(403).send({ message: "Email is required" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ role: user.role || "user" });
      } catch (error) {
        console.error("Error fetching role:", error);
        res.status(500).send({ message: "Failed to get user role" });
      }
    });

    //! -------------------------------------------------Participant API--------------------------------------------------

    // ----------------------Analytics API--------------------------------------
    app.get("/analytics/participant", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ message: "Email required" });
      }

      const registrations = await participantCollection
        .find({ participantEmail: email })
        .project({
          campName: 1,
          campFees: 1,
          paymentStatus: 1,
          joinedAt: 1,
        })
        .sort({ joinedAt: 1 })
        .toArray();

      res.send(registrations);
    });

    // ---------------Participant Profile API----------------------------------------

    app.get("/participants/profile/:email", async (req, res) => {
      const { email } = req.params;
      const profile = await participantCollection.findOne({
        participantEmail: email,
      });
      res.send(profile);
    });

    // -------------------Participant Feedback API----------------
    app.get("/participants/feedback/:participantId", async (req, res) => {
      try {
        const { participantId } = req.params;

        const participant = await participantCollection.findOne({
          _id: new ObjectId(participantId),
        });

        res.send(participant || null);
      } catch (error) {
        console.error("Feedback participant fetch error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // -------------Participant Registered API-------------
    app.get("/participants/registered/:email", async (req, res) => {
      const { email } = req.params;

      const participants = await participantCollection
        .find({ participantEmail: email })
        .toArray();

      res.send(participants);
    });
    // -----------------participant CAMP delete API---------------
    app.delete("/participants/registered/:campId", async (req, res) => {
      const { campId } = req.params;

      const result = await participantCollection.deleteOne({
        campId: campId,
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({ message: "Registration not found" });
      }

      res.send({ success: true });
    });

    // ------------Participant profile patch----------------
    app.patch("/participants/profile/:id", async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;
      // Prevent updating sensitive fields
      delete updateData.participantEmail;
      delete updateData.status;

      try {
        const result = await participantCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updateData,
              updatedAt: new Date(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Participant not found" });
        }

        res.send({
          message: "Profile updated successfully",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to update profile" });
      }
    });

    // ------------Participant API-------------------

    app.post("/participants", async (req, res) => {
      const participant = req.body;
      const result = await participantCollection.insertOne(participant);
      res.send(result);
    });

    // --------------Participant Pending API--------------
    app.get("/participants/pending", async (req, res) => {
      try {
        const pendingParticipants = await participantCollection
          .find({ status: "pending" })
          .toArray();

        res.send(pendingParticipants);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to load pending participants" });
      }
    });

    // -------------Participants API Patch------------

    app.patch(
      "/participants/:id/status",
      verifyFBToken,
      verifyOrganizer,
      async (req, res) => {
        const { id } = req.params;
        const { status, email } = req.body;
        const query = { _id: new ObjectId(id) };
        updatedDoc = {
          $set: {
            status,
          },
        };

        try {
          const result = await participantCollection.updateOne(
            query,
            updatedDoc
          );
          // update user role for accepting rider

          if (status === "active") {
            const userQuery = { email };
            const userUpdateDoc = {
              $set: {
                role: "participant",
              },
            };
            const roleResult = await usersCollection.updateOne(
              userQuery,
              userUpdateDoc
            );
            console.log(roleResult.modifiedCount);
          }

          res.send({
            message: "Participant status updated successfully",
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Failed to update participant status" });
        }
      }
    );
    // --------------------Active Participant API Get and Patch------------------
    app.get("/participants/active", async (req, res) => {
      const activeParticipants = await participantCollection
        .find({ status: "active" })
        .toArray();
      res.send(activeParticipants);
    });

    // !------------------------------------------ORGANIZER API------------------------------------------------

    app.get("/organizer/users/search", async (req, res) => {
      const emailQuery = req.query.email;

      if (!emailQuery) {
        return res.status(400).send({ message: "Email query is required" });
      }

      try {
        const users = await usersCollection
          .find({ email: { $regex: emailQuery, $options: "i" } })
          .project({ email: 1, role: 1, createdAt: 1 })
          .limit(10)
          .toArray();

        res.send(users);
      } catch (error) {
        console.error("Error searching users", error);
        res.status(500).send({ message: "Error searching users" });
      }
    });

    app.patch("/organizer/users/:id/make-organizer", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!["organizer", "user"].includes(role)) {
        return res.status(400).send({ message: "invalid role" });
      }

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send({
        message: `User role updated to ${role}`,
        result,
      });
    });

    // -----------------GET organizer registered participants----------------------------

    app.get("/organizer/participants", async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).send({ message: "Organizer email required" });
      }

      //  Get participants of those camps
      const participants = await participantCollection
        .find({})
        .sort({ joinedAt: -1 })
        .toArray();

      res.send({ participants });
    });

    // Confirm participant registration
    app.patch("/organizer/confirm/:id", async (req, res) => {
      const { id } = req.params;

      const participant = await participantCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!participant) {
        return res.status(404).send({ message: "Participant not found" });
      }

      if (participant.paymentStatus !== "paid") {
        return res.status(400).send({
          message: "Cannot confirm. Payment not completed.",
        });
      }

      if (participant.confirmationStatus === "confirmed") {
        return res.status(400).send({
          message: "Participant already confirmed",
        });
      }

      const result = await participantCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { confirmationStatus: "confirmed" } }
      );

      res.send({
        success: true,
        message: "Participant confirmed successfully",
      });
    });

    // Cancel participant registration
    app.delete("/organizer/cancel/:id", async (req, res) => {
      const id = req.params.id;

      const result = await participantCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // !------------------------Payment-------------------------
    // -----------get payment camp id-------------

    app.get("/participants/:id", async (req, res) => {
      const { id } = req.params;

      const participant = await participantCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!participant) {
        return res.status(404).send({ message: "Participant not found" });
      }

      res.send(participant);
    });

    // app.get("/camps/:id", async (req, res) => {
    //   const { id } = req.params;

    //   try {
    //     const camp = await participantCollection.findOne({
    //       _id: new ObjectId(id),
    //     });

    //     if (!camp) {
    //       return res.status(404).send({ message: "Camp not found" });
    //     }

    //     res.send(camp);
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ message: "Failed to fetch camp" });
    //   }
    // });

    // ----------------stripe payment method---------------

    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ---------------Payment Get API for participants--------------
    app.get("/payments/users", async (req, res) => {
      try {
        const { email } = req.query;

        const payments = await paymentsCollection
          .find({ participantEmail: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(payments);
      } catch (error) {
        console.error("error fetching payments history", error);
        res.status(500).send({ message: "Failed to get payments" });
      }
    });
    // ---------------user payments---------------
    app.get("/payments", async (req, res) => {
      try {
        const { email } = req.query;

        const payments = await paymentsCollection
          .find({ participantEmail: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(payments);
      } catch (error) {
        console.error("error fetching payments history", error);
        res.status(500).send({ message: "Failed to get payments" });
      }
    });

    // --------------Payment API GET for Organizer-----------------
    app.get("/payments/all", async (req, res) => {
      const payments = await paymentsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(payments);
    });

    // --------------Record payment and update Camp Status
    app.post("/payments", async (req, res) => {
      try {
        const {
          participantEmail,
          participantName,
          campId,
          campName,
          amount,
          paymentIntentId,
          paymentMethod,
          participantId,
        } = req.body;

        // Update participant payment Status
        const updateResultParticipant = await participantCollection.updateOne(
          {
            _id: new ObjectId(participantId),
            participantEmail: participantEmail,
          },
          {
            $set: {
              paymentStatus: "paid",
              paymentIntentId,
              // paid_at_string: new Date()
            },
          }
        );

        // Save payment history
        const paymentDoc = {
          participantEmail,
          participantName,
          participantId: new ObjectId(participantId),
          campId: new ObjectId(campId),
          campName,
          amount,
          paymentIntentId,
          paymentMethod,
          status: "paid",
          paid_at_string: new Date().toISOString(),
          createdAt: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.send({
          success: true,
          message: "Payment successful",
          paymentId: paymentResult.insertedId,
          updated: updateResultParticipant.modifiedCount,
        });
      } catch (error) {
        console.error("Payment save error:", error);
        res.status(500).send({ message: "Failed to save payment" });
      }
    });

    // !-------------------------------------------------------------
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Routes
app.get("/", (req, res) => {
  res.send("Medical Camp Management System API is running!");
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
