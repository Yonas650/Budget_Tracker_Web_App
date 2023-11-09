import './config.mjs';
import flash from 'connect-flash';
import express from 'express';
import session from 'express-session';
import mongoose from 'mongoose';
import { User } from './db.mjs'; 
import { Transaction} from './db.mjs'; 
import { Budget } from './db.mjs';
import bcrypt from 'bcryptjs'; // bcrypt for password hashing
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'hbs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(flash());
// Connect to MongoDB
mongoose.connect(process.env.DSN, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Express session setup
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Middleware to make the user ID available to all templates
app.use((req, res, next) => {
  res.locals.userId = req.session.userId;
  next();
});

// Routes

// Home route for login and signup
app.get('/', (req, res) => {
  res.render('home');
});

// Login logic
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username }).exec();

  if (user && await bcrypt.compare(password, user.password)) {
    req.session.userId = user._id; // Set the user session id
    res.redirect('/budgets'); // Redirect to transactions page
  } else {
    res.redirect('/'); // Redirect back to home if login fails
  }
});



// Signup logic
app.post('/signup', async (req, res) => {
    try {
      const { email, username, password } = req.body;
      const hashedPassword = await bcrypt.hash(password, 10); // Hash the password
      const newUser = new User({
        email,
        username,
        password: hashedPassword // Store the hashed password
      });
      
      await newUser.save(); // Save the new user to the database
      req.session.userId = newUser._id; // Automatically log in the new user
     res.redirect('/'); // Redirect to the transactions page
    } catch (error) {
      console.error('Signup error:', error);
      res.redirect('/'); // Redirect back to home on error
    }
  });
  
  app.post('/transactions', async (req, res) => {
    if (!req.session.userId) {
      return res.redirect('/login');
    }
  
    const { description, amount, date, type, category } = req.body;
    const transactionAmount = parseFloat(amount); // convert amount to a number

    try {
      // Find the budget category
      const budget = await Budget.findOne({
        user: req.session.userId,
        category: category
      });

      // If it's an expense and no budget exists, don't allow the transaction
      if (type === 'expense' && !budget) {
        return res.status(400).send('No budget category found for this expense.');
      }

      // Create a new transaction
      const newTransaction = new Transaction({
        user: req.session.userId,
        description,
        amount: transactionAmount,
        date,
        type,
        budget: budget ? budget._id : null // Link to the corresponding budget if it exists
      });
  
      await newTransaction.save();

      // Update the budget's spent amount if this is an expense and the budget exists
      if (budget && type === 'expense') {
        budget.spent += transactionAmount;
        await budget.save();
      }
  
      res.json({ success: true, message: 'Transaction added successfully.' }); // Send a success response
    } catch (error) {
      console.error('Transaction creation error:', error);
      res.status(500).json({ success: false, message: 'Error adding transaction.' });
    }
});
  
app.get('/api/budgets', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('Not authenticated');
    }
    
    try {
        let userBudgets = await Budget.find({ user: req.session.userId }).exec();
        userBudgets = userBudgets.filter(budget => budget.category && budget.allocatedAmount && budget.amountLeft);

        const user = await User.findById(req.session.userId).exec();
        // Set headers to prevent caching
        res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.header('Pragma', 'no-cache');
        res.header('Expires', '0');
        res.json({ budgets: userBudgets, income: user.income });
    } catch (error) {
        console.error('Error fetching budgets:', error);
        res.status(500).json({ error: 'Error fetching budgets' });
    }
});

  


// Route to serve the budgets page
app.get('/budgets', async (req, res) => {
    if (!req.session.userId) {
      // Redirect to login page if the user is not logged in
      return res.redirect('/login');
    }
  
    try {
      // Fetch budgets from the database for the logged-in user
      const userBudgets = await Budget.find({ user: req.session.userId });
      console.log(userBudgets);  // Check the output in your console
      // Render the budgets page and pass the userBudgets to the template
      res.render('budgets', { userBudgets });
    } catch (error) {
      console.error('Error fetching budgets:', error);
      res.status(500).send('Error fetching budgets');
    }
  });
  // POST route for creating a new budget
  app.post('/budgets/create', async (req, res) => {
    if (!req.session.userId) {
      // If the user is not logged in, redirect to the login page.
      return res.redirect('/login');
    }
  
    const { category, allocatedAmount } = req.body;
    const parsedAllocatedAmount = parseFloat(allocatedAmount);
  
    if (isNaN(parsedAllocatedAmount) || parsedAllocatedAmount <= 0) {
      // If the allocated amount is not a positive number, handle the error.
      // You might want to use flash messages to show errors.
      req.flash('error', 'Allocated amount must be a positive number.');
      return res.redirect('/budgets');
    }
  
    const user = await User.findById(req.session.userId);
    const totalAllocated = await Budget.aggregate([
        { $match: { user: req.session.userId } },
        { $group: { _id: null, total: { $sum: '$allocatedAmount' } } }
    ]);

    if (req.body.allocatedAmount + totalAllocated.total > user.income) {
        // Handle the case where the new budget would exceed the income
        return res.status(400).send('The total allocated budget cannot exceed your income.');
    }

    try {
      // Create a new budget with the form values.
      const newBudget = new Budget({
        user: req.session.userId,
        category,
        allocatedAmount: parsedAllocatedAmount,
        amountLeft: parsedAllocatedAmount,
      });
  
      // Save the new budget to the database.
      await newBudget.save();
  
      // After saving, redirect back to the budgets page to see the new budget.
      // You can use flash messages to show a success message.
      req.flash('success', 'Budget added successfully.');
      res.redirect('/budgets');
    } catch (error) {
      // Handle any errors that occur during budget creation.
      console.error('Error creating budget:', error);
      req.flash('error', 'Error creating budget.');
      res.redirect('/budgets');
    }
  });
  
  

// POST route for deleting an existing budget
app.post('/budgets/delete/:budgetId', async (req, res) => {
  if (!req.session.userId) {
      return res.redirect('/login');
  }

  const { budgetId } = req.params;

  try {
      await Budget.findByIdAndRemove(budgetId);
      req.flash('success', 'Budget deleted successfully.');
      res.redirect('/budgets');
  } catch (error) {
      console.error('Error deleting budget:', error);
      req.flash('error', 'Error deleting budget.');
      res.redirect('/budgets');
  }
});

  


  // POST route for setting user's income in app.mjs
app.post('/api/set-income', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in to set income.');
    }

    const { income } = req.body;

    try {
        // Find the user by session userId and update their income
        await User.findByIdAndUpdate(req.session.userId, { income });
       // res.send({ success: true, message: 'Income set successfully.' });
    } catch (error) {
        console.error('Error setting income:', error);
        res.status(500).send({ success: false, message: 'Error setting income.' });
    }
});

  // Server start
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
  });
  