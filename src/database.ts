import { Sequelize, DataTypes, Model } from 'sequelize';
import * as dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

const sequelize = databaseUrl 
  ? new Sequelize(databaseUrl, {
      logging: false,
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      }
    })
  : new Sequelize({
      dialect: 'sqlite',
      storage: 'database.sqlite',
      logging: false,
    });

export class Student extends Model {
  public id!: number;
  public telegramId!: number;
  public fullName!: string;
  public grade!: number;
  public school!: string;
  public phone!: string;
  public paymentStatus!: 'pending' | 'approved' | 'rejected';
  public receiptFileId!: string | null;
  public createdAt!: Date;
}

Student.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    telegramId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    grade: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    school: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    paymentStatus: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      defaultValue: 'pending',
    },
    receiptFileId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Student',
  }
);

export const initDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established.');
    await sequelize.sync();
    console.log('Database synced');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
};

export default Student;
