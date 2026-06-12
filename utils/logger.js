/**
 * Logger Configuration
 * Winston logger for production-ready logging
 */

const winston = require('winston');
const path = require('path');

const logLevel = process.env.LOG_LEVEL || 'info';

// Helper function to check if object contains SQL
function containsSQL(obj) {
  const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'VALUES', 'INTO', 'SET', 'JOIN', 'ON'];
  
  try {
    const str = JSON.stringify(obj);
    return sqlKeywords.some(keyword => str.includes(keyword));
  } catch (e) {
    return false;
  }
}

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    // Aggressively filter out SQL query logs
    winston.format((info) => {
      // Skip entire log if it contains SQL anywhere
      if (containsSQL(info)) {
        return false;
      }
      return info;
    })(),
    winston.format.json()
  ),
  defaultMeta: { service: 'homework-api' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          // Skip entire log if it contains SQL
          const logObj = { timestamp, level, message, ...meta };
          if (containsSQL(logObj)) {
            return ''; // Skip logging completely
          }
          
          // Filter meta fields that might contain SQL
          const filteredMeta = {};
          Object.keys(meta).forEach(key => {
            if (!containsSQL(meta[key])) {
              filteredMeta[key] = meta[key];
            }
          });
          
          return `${timestamp} [${level}]: ${message} ${
            Object.keys(filteredMeta).length ? JSON.stringify(filteredMeta, null, 2) : ''
          }`;
        })
      ),
    }),
    // Write error logs to file
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs to file
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

module.exports = logger;
