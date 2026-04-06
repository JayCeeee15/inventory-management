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
-- Temporary view structure for view `vw_product_stock_summary`
--

DROP TABLE IF EXISTS `vw_product_stock_summary`;
/*!50001 DROP VIEW IF EXISTS `vw_product_stock_summary`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `vw_product_stock_summary` AS SELECT 
 1 AS `product_id`,
 1 AS `sku`,
 1 AS `product_name`,
 1 AS `category_name`,
 1 AS `unit`,
 1 AS `price`,
 1 AS `reorder_level`,
 1 AS `qty_on_hand`,
 1 AS `qty_reserved`,
 1 AS `qty_available`*/;
SET character_set_client = @saved_cs_client;

--
-- Final view structure for view `vw_product_stock_summary`
--

/*!50001 DROP VIEW IF EXISTS `vw_product_stock_summary`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `vw_product_stock_summary` AS select `p`.`id` AS `product_id`,`p`.`sku` AS `sku`,`p`.`name` AS `product_name`,`c`.`name` AS `category_name`,`p`.`unit` AS `unit`,`p`.`price` AS `price`,`p`.`reorder_level` AS `reorder_level`,coalesce(sum(`s`.`qty_on_hand`),0) AS `qty_on_hand`,coalesce(sum(`s`.`qty_reserved`),0) AS `qty_reserved`,(coalesce(sum(`s`.`qty_on_hand`),0) - coalesce(sum(`s`.`qty_reserved`),0)) AS `qty_available` from ((`products` `p` join `categories` `c` on((`c`.`id` = `p`.`category_id`))) left join `inventory_stock` `s` on((`s`.`product_id` = `p`.`id`))) group by `p`.`id`,`p`.`sku`,`p`.`name`,`c`.`name`,`p`.`unit`,`p`.`price`,`p`.`reorder_level` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-03-19  7:19:35
