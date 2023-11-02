import mongoose from 'mongoose';

// Define the User schema
// Users have a username, password, email, and can have multiple budgets
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true }, // Must be unique and is required
  password: { type: String, required: true }, // Password is required for security
  email: { type: String, required: true, unique: true }, // Email must be unique and is required
  budgets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Budget' }], // An array of references to Budget documents
});

// Create a model from the schema
const User = mongoose.model('User', userSchema);

// Define the Budget schema
// Budgets are linked to a user, have a category, an allocated amount, and an amount spent
const budgetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to the User who owns this Budget
  category: String, // Category of the budget e.g., 'Food', 'Rent'
  amount: Number, // The total amount allocated to this budget
  spent: Number, // The amount already spent from this budget
});

// Create a model from the schema
const Budget = mongoose.model('Budget', budgetSchema);

// Define the Transaction schema
// Transactions belong to a user, have a description, amount, date, and type (income or expense)
const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to the User who owns this Transaction
  description: String, // A brief description of the transaction
  amount: Number, // The monetary value of the transaction
  date: Date, // The date of the transaction
  type: { type: String, enum: ['income', 'expense'] } // Specifies whether the transaction is income or an expense
});

// Create a model from the schema
const Transaction = mongoose.model('Transaction', transactionSchema);

// Export the models to be used in other parts of our application
export { User, Budget, Transaction };
