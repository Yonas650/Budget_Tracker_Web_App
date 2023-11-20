import './config.mjs';
import flash from 'connect-flash';
import express from 'express';
import session from 'express-session';
import mongoose from 'mongoose';
import { User } from './db.mjs'; 
import { Transaction} from './db.mjs'; 
import { Budget } from './db.mjs';
import bcrypt from 'bcryptjs'; // bcrypt for password hashing, should change it back to bcryptjs
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'hbs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(flash());

// Create an HTTP server from the Express app
const server = http.createServer(app);

// Attach Socket.IO to the server
const io = new SocketIOServer(server);

// Connect to MongoDB
mongoose.connect(process.env.DSN)
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
  
  app.post('/transactions/create', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    const { budgetId, amount, date } = req.body;
    const transactionAmount = parseFloat(amount);

    try {
        const budget = await Budget.findById(budgetId);

        if (transactionAmount > budget.amountLeft) {
            req.flash('error', 'Transaction amount exceeds budget left.');
            return res.redirect('/transactions');
        }

        const newTransaction = new Transaction({
            user: req.session.userId,
            budget: budgetId,
            amount: transactionAmount,
            date,
            type: 'expense'
        });

        await newTransaction.save();

        budget.amountLeft -= transactionAmount;
        await budget.save();

        // Emit an event to all connected clients
        io.emit('transaction update');

        req.flash('success', 'Transaction added successfully.');
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error creating transaction:', error);
        req.flash('error', 'Error creating transaction.');
        res.redirect('/transactions');
    }
});

  
// Route for the transactions page
app.get('/transactions', async (req, res) => {
  if (!req.session.userId) {
      return res.redirect('/login');
  }

  try {
      const userBudgets = await Budget.find({ user: req.session.userId });
      if (userBudgets.length === 0) {
          req.flash('error', 'Please add a budget before making transactions.');
          return res.redirect('/budgets');
      }

      res.render('transactions', { userBudgets });
  } catch (error) {
      console.error('Error loading transactions page:', error);
      req.flash('error', 'Error loading transactions page.');
      res.redirect('/dashboard');
  }
});

// Route for the dashboard page
app.get('/dashboard', async (req, res) => {
  if (!req.session.userId) {
      return res.redirect('/login');
  }

  try {
      const user = await User.findById(req.session.userId);
      const transactions = await Transaction.find({ user: req.session.userId });

      let totalExpense = 0;
      transactions.forEach(transaction => {
          if (transaction.type === 'expense') {
              totalExpense += transaction.amount;
          }
      });

      const balance = user.income - totalExpense;

      res.render('dashboard', {
          income: user.income,
          totalExpense,
          balance
      });

      // Emit event for updating dashboard whenever a user visits the dashboard page
      io.emit('update dashboard', {
          userId: req.session.userId,
          income: user.income,
          totalExpense,
          balance
      });
      
  } catch (error) {
      console.error('Error loading dashboard:', error);
      req.flash('error', 'Error loading dashboard.');
      res.redirect('/');
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
      return res.redirect('/login');
  }

  try {
      const user = await User.findById(req.session.userId);
      const userBudgets = await Budget.find({ user: req.session.userId });

      // Calculate the sum of all allocated amounts
      const totalAllocated = userBudgets.reduce((sum, budget) => sum + budget.allocatedAmount, 0);

      // Calculate available funds
      const availableFunds = user.income - totalAllocated;

      res.render('budgets', {
          userBudgets,
          income: user.income, // Display the constant income of the user
          availableFunds // Available funds after budget allocation
      });
  } catch (error) {
      console.error('Error fetching budgets:', error);
      req.flash('error', 'Error fetching budgets.');
      res.redirect('/dashboard');
  }
});



  // POST route for creating a new budget
app.post('/budgets/create', async (req, res) => {
  if (!req.session.userId) {
      return res.redirect('/login');
  }

  const { category, allocatedAmount } = req.body;
  const parsedAllocatedAmount = parseFloat(allocatedAmount);

  if (isNaN(parsedAllocatedAmount) || parsedAllocatedAmount <= 0) {
      return res.redirect('/budgets');
  }

  try {
      const user = await User.findById(req.session.userId);
      if (user.income < parsedAllocatedAmount) {
          return res.status(400).send('Allocated amount cannot exceed available income.');
      }

      const newBudget = new Budget({
          user: req.session.userId,
          category,
          allocatedAmount: parsedAllocatedAmount,
          amountLeft: parsedAllocatedAmount,
      });

      await newBudget.save();

      // Emit an event to all connected clients
      io.emit('budget update', {
          message: 'A new budget category was added.',
          category: newBudget.category,
          allocatedAmount: newBudget.allocatedAmount
      });

      res.redirect('/budgets');
  } catch (error) {
      console.error('Error creating budget:', error);
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
      const deletedBudget = await Budget.findByIdAndRemove(budgetId);
      if (deletedBudget) {
        // Emit an event to all connected clients after successful deletion
        io.emit('budget delete', {
            message: 'A budget category was deleted.',
            deletedBudgetId: budgetId
        });

        req.flash('success', 'Budget deleted successfully.');
      } else {
        req.flash('error', 'Budget not found or already deleted.');
      }
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
        // Update the user's income
        await User.findByIdAndUpdate(req.session.userId, { income: parseFloat(income) });
        req.flash('success', 'Income set/updated successfully.');
        res.redirect('/budgets');
    } catch (error) {
        console.error('Error setting income:', error);
        req.flash('error', 'Error setting income.');
        res.redirect('/budgets');
    }
});




// Route to serve the profile page
app.get('/profile', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  try {
    const user = await User.findById(req.session.userId);
    res.render('profile', { user: user });
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.redirect('/dashboard');
  }
});

// Route to update user's profile
app.post('/profile/update', async (req, res) => {
  const { username, email } = req.body;
  console.log('Attempting to update user profile for ID:', req.session.userId);
  console.log('Received username:', username, 'Received email:', email);

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.session.userId,
      { username, email },
      { new: true, runValidators: true }
    );
    console.log('Updated user:', updatedUser);

    if (!updatedUser) {
      console.log('No user found with the given ID.');
      req.flash('error', 'No user found to update.');
      return res.redirect('/profile');
    }

    // Emit a Socket.IO event after successful profile update
    io.emit('profile update', { message: 'Profile updated successfully', userId: req.session.userId });

    req.flash('success', 'Profile updated successfully.');
    res.redirect('/profile');
  } catch (error) {
    console.error('Error updating profile:', error);
    req.flash('error', 'Error updating profile.');
    res.redirect('/profile');
  }
});



// Route to change user's password
app.post('/profile/change-password', async (req, res) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;
  if (newPassword !== confirmNewPassword) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('/profile');
  }

  try {
    const user = await User.findById(req.session.userId);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/profile');
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    await user.save();

    req.flash('success', 'Password changed successfully.');
    res.redirect('/profile');
  } catch (error) {
    console.error('Error changing password:', error);
    req.flash('error', 'Error changing password.');
    res.redirect('/profile');
  }
});






  // Server start
  const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
  