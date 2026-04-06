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
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `category_id` bigint unsigned NOT NULL,
  `sku` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unit` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unit',
  `price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `reorder_level` int unsigned NOT NULL DEFAULT '0',
  `controlled_flag` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_sku` (`sku`),
  KEY `idx_products_category` (`category_id`),
  KEY `idx_products_name` (`name`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` VALUES (1,2,'MED-PARA-500','Paracetamol 500mg',NULL,'box',4.50,80,0,1,'2026-03-04 02:31:06','2026-03-04 02:31:06'),(2,1,'MED-AMOX-500','Amoxicillin 500mg',NULL,'box',13.75,1000,0,0,'2026-03-04 02:31:06','2026-03-18 05:37:55'),(3,3,'SUP-IVCAN-22','IV Cannula 22G',NULL,'pack',19.00,35,0,1,'2026-03-04 02:31:06','2026-03-04 02:31:06'),(4,6,'PPE-N95-BOX','N95 Respirator',NULL,'box',13.00,30,0,1,'2026-03-04 02:31:06','2026-03-04 02:31:06'),(5,4,'SURG-GLV-M','Surgical Gloves Medium',NULL,'box',9.20,40,0,1,'2026-03-04 02:31:06','2026-03-04 02:31:06'),(11,7,'TEST-SKU-2993','API Test Product Updated','Updated','box',8.25,6,1,0,'2026-03-04 03:46:23','2026-03-04 03:46:23'),(27,1,'BG','Biogesic','Tambal sa hilanat','unit',5.00,1000,0,1,'2026-03-06 03:19:20','2026-03-18 05:27:21'),(28,1,'MED-CEFA-500','Cefalexin 500mg','Antibiotic capsules for bacterial infections','box',15.00,80,0,1,'2026-03-18 07:00:14','2026-03-18 07:00:14'),(29,2,'MED-AMLO-5','Amlodipine 5mg','Maintenance medicine for blood pressure','box',12.50,100,0,1,'2026-03-18 07:02:20','2026-03-18 07:02:20'),(30,2,'MED-OMEP-20','Omeprazole 20mg','Acid reducer capsule for GERD/ulcer','box',6.20,90,0,1,'2026-03-18 07:03:37','2026-03-18 07:03:37'),(31,3,'SUP-GZE-4X4','Gauze Pads 4x4','Sterile gauze pads 4x4 inches','box',5.40,70,0,1,'2026-03-18 07:04:42','2026-03-18 07:04:42'),(32,3,'SUP-COT-ROLL','Cotton Roll','Absorbent cotton roll for wound care','box',6.20,60,0,1,'2026-03-18 07:05:30','2026-03-18 07:05:30'),(34,6,'SUP-SURG-MSK','Surgical Mask 3-ply','Disposable 3-ply surgical masks','box',7.00,120,0,1,'2026-03-18 07:07:28','2026-03-18 07:07:28'),(35,6,'SUP-N95-M','N95 Mask Medium','N95 respirator mask medium size','box',15.00,40,0,1,'2026-03-18 07:08:05','2026-03-18 07:08:05'),(36,4,'SUR-SUT-3-0','Suture Silk 3-0','Sterile surgical suture silk 3-0','box',10.00,30,0,1,'2026-03-18 07:08:56','2026-03-18 07:08:56'),(37,4,'SUR-IV-SET','IV Administration Set','IV set for infusion/IV therapy','Box',7.25,50,0,1,'2026-03-18 07:20:21','2026-03-18 07:20:21'),(38,5,'LAB-RDT-CBC','CBC Test Kit','Lab kit for CBC testing supplies','Box',18.00,20,0,1,'2026-03-18 07:20:51','2026-03-18 07:20:51');
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-03-19  7:19:32
