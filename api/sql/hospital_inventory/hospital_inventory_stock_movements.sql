-- MySQL dump 10.13  Distrib 8.0.45, for Win64 (x86_64)
--
-- Host: localhost    Database: hospital_inventory
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `stock_movements`
--

DROP TABLE IF EXISTS `stock_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_movements` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `product_id` bigint unsigned NOT NULL,
  `location_id` bigint unsigned DEFAULT NULL,
  `movement_type` enum('RECEIVE','SALE_WALKIN','SALE_ONLINE','PATIENT_ISSUE','RETURN','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_OUT','TRANSFER_IN') COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int NOT NULL,
  `unit_cost` decimal(12,2) DEFAULT NULL,
  `reference_type` enum('purchase_receipt','sale','patient_issue','adjustment','transfer','return','manual','customer_order') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `reference_id` bigint unsigned DEFAULT NULL,
  `notes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_stock_movements_product_created` (`product_id`,`created_at`),
  KEY `idx_stock_movements_location_created` (`location_id`,`created_at`),
  KEY `idx_stock_movements_type_created` (`movement_type`,`created_at`),
  KEY `idx_stock_movements_reference` (`reference_type`,`reference_id`),
  KEY `fk_stock_movements_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_stock_movements_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_movements_location` FOREIGN KEY (`location_id`) REFERENCES `locations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_movements_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=57 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `stock_movements`
--

LOCK TABLES `stock_movements` WRITE;
/*!40000 ALTER TABLE `stock_movements` DISABLE KEYS */;
INSERT INTO `stock_movements` VALUES (18,2,2,'RECEIVE',500,15.00,'manual',NULL,NULL,1,'2026-03-18 04:39:22'),(19,2,1,'RECEIVE',100,15.00,'manual',NULL,NULL,1,'2026-03-18 04:40:03'),(20,2,1,'RECEIVE',100,12.00,'manual',NULL,NULL,1,'2026-03-18 04:40:09'),(21,2,3,'RECEIVE',300,10.00,'manual',NULL,NULL,1,'2026-03-18 04:40:21'),(22,2,3,'SALE_WALKIN',-200,13.75,'sale',21,'amox 200 pcs',7,'2026-03-18 05:23:25'),(23,27,2,'RECEIVE',645,10.00,'manual',NULL,NULL,1,'2026-03-18 05:24:36'),(24,3,2,'RECEIVE',845,20.00,'manual',NULL,NULL,1,'2026-03-18 05:24:51'),(25,4,2,'RECEIVE',450,15.00,'manual',NULL,NULL,1,'2026-03-18 05:25:04'),(26,1,2,'RECEIVE',1250,9.00,'manual',NULL,NULL,1,'2026-03-18 05:25:12'),(27,5,2,'RECEIVE',560,9.20,'manual',NULL,NULL,1,'2026-03-18 05:26:51'),(28,27,1,'RECEIVE',450,8.00,'manual',NULL,NULL,1,'2026-03-18 05:30:07'),(29,27,4,'RECEIVE',1000,15.00,'manual',NULL,NULL,1,'2026-03-18 05:30:18'),(30,27,3,'RECEIVE',650,10.00,'manual',NULL,NULL,1,'2026-03-18 05:30:29'),(31,3,1,'RECEIVE',550,10.00,'manual',NULL,NULL,1,'2026-03-18 05:30:47'),(32,3,4,'RECEIVE',850,20.00,'manual',NULL,NULL,1,'2026-03-18 05:30:56'),(33,3,3,'RECEIVE',500,15.00,'manual',NULL,NULL,1,'2026-03-18 05:31:10'),(34,4,1,'RECEIVE',450,9.00,'manual',NULL,NULL,1,'2026-03-18 05:31:32'),(35,4,4,'RECEIVE',1580,20.00,'manual',NULL,NULL,1,'2026-03-18 05:31:41'),(36,4,3,'RECEIVE',1000,10.00,'manual',NULL,NULL,1,'2026-03-18 05:31:50'),(37,1,1,'RECEIVE',5000,3.00,'manual',NULL,NULL,1,'2026-03-18 05:32:03'),(38,1,4,'RECEIVE',560,10.00,'manual',NULL,NULL,1,'2026-03-18 05:32:10'),(39,1,3,'RECEIVE',650,8.50,'manual',NULL,NULL,1,'2026-03-18 05:32:20'),(40,5,1,'RECEIVE',800,5.00,'manual',NULL,NULL,1,'2026-03-18 05:32:31'),(41,5,4,'RECEIVE',600,20.00,'manual',NULL,NULL,1,'2026-03-18 05:32:54'),(42,5,3,'RECEIVE',800,15.00,'manual',NULL,NULL,1,'2026-03-18 05:33:17'),(43,28,2,'RECEIVE',200,15.00,'manual',NULL,'Initial stock',1,'2026-03-18 07:00:14'),(44,29,2,'RECEIVE',250,12.50,'manual',NULL,'Initial stock',1,'2026-03-18 07:02:21'),(45,30,2,'RECEIVE',220,6.20,'manual',NULL,'Initial stock',1,'2026-03-18 07:03:37'),(46,31,1,'RECEIVE',300,5.40,'manual',NULL,'Initial stock',1,'2026-03-18 07:04:42'),(47,32,1,'RECEIVE',200,6.20,'manual',NULL,'Initial stock',1,'2026-03-18 07:05:30'),(48,34,1,'RECEIVE',500,7.00,'manual',NULL,'Initial stock',1,'2026-03-18 07:07:28'),(49,35,1,'RECEIVE',150,15.00,'manual',NULL,'Initial stock',1,'2026-03-18 07:08:05'),(50,36,2,'RECEIVE',120,10.00,'manual',NULL,'Initial stock',1,'2026-03-18 07:08:56'),(51,37,2,'RECEIVE',180,7.25,'manual',NULL,'Initial stock',1,'2026-03-18 07:20:21'),(52,38,1,'RECEIVE',60,18.00,'manual',NULL,'Initial stock',1,'2026-03-18 07:20:51'),(53,29,2,'SALE_WALKIN',-200,12.50,'sale',22,'palit ko',7,'2026-03-18 07:23:02'),(54,3,2,'SALE_WALKIN',-200,19.00,'sale',22,'palit ko',7,'2026-03-18 07:23:02'),(55,30,2,'SALE_WALKIN',-20,6.20,'sale',22,'palit ko',7,'2026-03-18 07:23:02'),(56,34,1,'SALE_WALKIN',-200,7.00,'sale',22,'palit ko',7,'2026-03-18 07:23:02');
/*!40000 ALTER TABLE `stock_movements` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-03-19  7:19:31
